import type { TikTokSoundStats } from "@/lib/platforms/tiktokSound";
import { fetchTikTokSoundStats } from "@/lib/platforms/tiktokSound";
import {
  fetchTikTokMusicEmbedHtmlDirect,
  parseTikTokMusicEmbed,
} from "@/lib/platforms/tiktokSoundEmbed";
import {
  openSandboxProfileFetcher,
  type SandboxProfileFetcher,
} from "@/lib/platforms/tiktokProfileSandbox";
import { createLogger } from "@/lib/observability/logger";

/**
 * Reading how many videos use a TikTok sound, for a whole set of sounds at once.
 *
 * Every caller that needed this used to build its own ladder inline -- the
 * nightly snapshot job, the hourly tracker sweep and the campaign refresh all
 * had their own copy, and they had already drifted: one of them still paid a
 * fifteen-second timeout on the music page, a rung tiktokSoundEmbed.ts has
 * documented as never having answered from a server. This is that ladder, once,
 * and the three shapes of waste it used to carry are gone:
 *
 *  - **Serial.** A sweep read one sound, waited, read the next. At ~1s a direct
 *    embed and 93 tracked sounds that is a minute and a half of a five-minute
 *    function budget spent waiting on a socket. The direct rung now runs a
 *    bounded pool.
 *  - **A sandbox nobody needed.** The fallback sandbox was opened lazily but
 *    per-sweep, so one unreadable sound in ninety-three paid a boot -- and
 *    Provisioned Memory bills wall-clock, not CPU. The sandbox is now opened
 *    only after the direct rung has finished and left something unread, and
 *    every miss shares that one boot.
 *  - **Duplicate reads.** Sounds are rows, and the same `tiktokSoundId` can be
 *    tracked by two orgs. Keying by the platform's id rather than by our row
 *    means TikTok is asked once and both rows are answered.
 *
 * The rung that answered travels back with the reading, because the callers
 * need it: a zero from an embed is TikTok saying "this sound exists and nothing
 * uses it", which is what a brand's freshly uploaded audio looks like on day
 * one, while a zero from the music-page fallback is that path's way of saying it
 * could not read. Same number, opposite meaning.
 */

export type UsageRung = "embed-direct" | "embed-sandbox" | "music-page";

/** An embed rung's zero is a measurement; the music page's is not. */
export function isMeasuredRung(rung: UsageRung): boolean {
  return rung === "embed-direct" || rung === "embed-sandbox";
}

export type AudioUsageOutcome =
  | { ok: true; rung: UsageRung; stats: TikTokSoundStats }
  /** Asked, and no rung produced a reading. */
  | { ok: false; reason: "no-reading" }
  /** Never asked -- the run ran out of time first. Not a failure, and callers
   *  must not alert on it or it would page whenever a sweep is simply large. */
  | { ok: false; reason: "deadline" };

export type ReadAudioUsageOptions = {
  /** Parallel direct fetches. Six keeps a sweep inside a function budget without
   *  arriving at TikTok as a burst; the sandbox rung uses half of it, because
   *  each of those is a process in one small box rather than a socket. */
  concurrency?: number;
  /** Epoch ms. Ids not reached by then come back as `deadline`. */
  deadlineAt?: number;
  /** A sandbox already open for another sweep. When given it is used and NOT
   *  closed here -- whoever opened it owns its lifetime. */
  sandbox?: SandboxProfileFetcher | null;
  /** The music page. Off by default: it has never produced a reading from a
   *  server, and trying costs a timeout per unread sound. */
  allowMusicPage?: boolean;
};

const DEFAULT_CONCURRENCY = 6;

/** Run `fn` over `items`, at most `limit` in flight. Order is not preserved;
 *  results go wherever `fn` puts them. */
async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  });
  await Promise.all(workers);
}

/**
 * @param ids platform sound ids (`TikTokSound.tiktokSoundId`), not our row ids.
 * @returns one entry per DISTINCT id. A caller holding two rows on the same id
 *   reads both answers out of the same entry.
 */
export async function readTikTokAudioUsage(
  ids: string[],
  options: ReadAudioUsageOptions = {}
): Promise<Map<string, AudioUsageOutcome>> {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    deadlineAt,
    sandbox: providedSandbox = null,
    allowMusicPage = false,
  } = options;

  const log = createLogger({ context: { reader: "tiktok-audio-usage" } });
  const out = new Map<string, AudioUsageOutcome>();

  const distinct = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (distinct.length === 0) return out;

  const outOfTime = () => deadlineAt !== undefined && Date.now() > deadlineAt;

  /* Rung 1: the embed over plain egress. One HTTPS request, and on a healthy
     run it is the only rung that runs at all. */
  await pool(distinct, concurrency, async (id) => {
    if (outOfTime()) {
      out.set(id, { ok: false, reason: "deadline" });
      return;
    }
    const html = await fetchTikTokMusicEmbedHtmlDirect(id).catch(() => null);
    const stats = html ? parseTikTokMusicEmbed(html, id) : null;
    if (stats) out.set(id, { ok: true, rung: "embed-direct", stats });
  });

  const unread = distinct.filter((id) => !out.has(id));
  if (unread.length === 0) return out;

  /* Rung 2: the same embed from a sandbox in iad1, for the ids plain egress
     could not read -- a WAF shell and a region refusal are both HTTP 200, so
     "could not read" is decided by the parser, not the status code.

     Nothing above this line can open a sandbox. That is the point of splitting
     the rungs: a sweep whose sounds all answer directly never boots one, and a
     sweep where one sound does not pays exactly one boot for all of them. */
  let ownSandbox: SandboxProfileFetcher | null = null;
  const sandbox =
    providedSandbox ?? (outOfTime() ? null : (ownSandbox = openSandboxProfileFetcher()));

  try {
    if (sandbox) {
      await pool(unread, Math.max(1, Math.floor(concurrency / 2)), async (id) => {
        if (outOfTime()) return;
        const html = await sandbox.readMusicEmbedHtml(id).catch((error) => {
          log.warn("sandbox embed read failed", {
            tiktokSoundId: id,
            error: error instanceof Error ? error.message : String(error),
          });
          return null;
        });
        const stats = html ? parseTikTokMusicEmbed(html, id) : null;
        if (stats) out.set(id, { ok: true, rung: "embed-sandbox", stats });
      });
    }

    /* Rung 3: the music page's rehydration blob. Opt-in, and last. */
    if (allowMusicPage) {
      const stillUnread = distinct.filter((id) => !out.has(id));
      await pool(stillUnread, concurrency, async (id) => {
        if (outOfTime()) return;
        const stats = await fetchTikTokSoundStats(id).catch(() => null);
        if (stats) out.set(id, { ok: true, rung: "music-page", stats });
      });
    }
  } finally {
    if (ownSandbox) await ownSandbox.close().catch(() => {});
  }

  for (const id of distinct) {
    if (out.has(id)) continue;
    out.set(id, { ok: false, reason: outOfTime() ? "deadline" : "no-reading" });
  }

  return out;
}

/** One sound. Same ladder, and it still opens a sandbox only if the direct
 *  read came back empty -- which is what makes it cheap enough to run inline
 *  when an operator attaches audio to a campaign. */
export async function readOneTikTokAudioUsage(
  tiktokSoundId: string,
  options: ReadAudioUsageOptions = {}
): Promise<AudioUsageOutcome> {
  const map = await readTikTokAudioUsage([tiktokSoundId], options);
  return map.get(String(tiktokSoundId).trim()) ?? { ok: false, reason: "no-reading" };
}
