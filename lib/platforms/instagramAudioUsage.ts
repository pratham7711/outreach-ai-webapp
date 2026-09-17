import {
  instagramAudioPageUrl,
  parseInstagramAudioPage,
  type InstagramAudioReading,
} from "@/lib/platforms/instagramAudioPage";
import { createLogger } from "@/lib/observability/logger";

/**
 * Reading how many reels use an Instagram audio, for a whole set at once.
 *
 * Deliberately the same shape as readTikTokAudioUsage: ids in, one entry per
 * DISTINCT id out, a bounded pool, a deadline that reports `deadline` rather
 * than failure, and the reason travelling back with the answer. The two
 * platforms are read from completely different places -- TikTok from an embed
 * that sometimes needs a sandbox, Instagram from one plain HTTPS GET -- and the
 * callers should not have to care which.
 *
 * There is no ladder here and there is not meant to be. TikTok needs three
 * rungs because its music endpoint refuses a server outright; Instagram's audio
 * page answers a plain fetch on the first try, and the only thing a second rung
 * could add is a browser, which would cost a sandbox boot to re-read a page we
 * already have. If the OG block ever stops being served, that is a change worth
 * noticing rather than papering over.
 *
 * What this reader will NOT do is turn an absence into a zero. Instagram
 * answers 200 for an id that is not an audio page at all, and original audio
 * publishes no count while plainly existing. Both come back as their own
 * outcome. See lib/platforms/instagramAudioPage for the three shapes and the
 * measurements behind them.
 */

/** Why an Instagram audio read produced no number. Each is a different thing to
 *  do about it, which is why they are not one `failed`. */
export type InstagramAudioFailure =
  /** Instagram served the generic audio shell: no such audio cluster. */
  | "not-found"
  /** The page exists and publishes no count. Original audio does this. */
  | "no-count"
  /** Reached, and the Open Graph block was not there. */
  | "unreadable"
  /** The request itself failed -- network, non-2xx, or a timeout. */
  | "fetch-failed"
  /** Never asked, because the run ran out of time. Not a failure; callers must
   *  not alert on it or a large sweep pages ops on its own size. */
  | "deadline";

export type InstagramAudioOutcome =
  | { ok: true; reading: InstagramAudioReading }
  | { ok: false; reason: InstagramAudioFailure };

export type ReadInstagramAudioOptions = {
  /** Parallel fetches. Four rather than TikTok's six: this is one origin, each
   *  response is ~700KB, and a sweep of a few dozen sounds is not worth
   *  arriving at Instagram as a burst. */
  concurrency?: number;
  /** Epoch ms. Ids not reached by then come back as `deadline`. */
  deadlineAt?: number;
  /** Per-request timeout. The page is large but static; a slow one is better
   *  abandoned than allowed to eat the sweep's budget. */
  timeoutMs?: number;
};

/**
 * Who we say we are.
 *
 * Honest and self-identifying, with a URL a Meta engineer can look up. This is
 * a deliberate choice and the measurement behind it is in instagramAudioPage:
 * an anonymous request and a named-crawler request are served the same OG block
 * as this one, so there is nothing to gain by claiming to be Googlebot and a
 * real objection to doing it. A *browser* UA is the one string that must not be
 * sent -- Instagram answers it with the client-rendered shell and no metadata,
 * so pretending to be Chrome would break the reader as well as misrepresent it.
 */
const USER_AGENT = "MadeBoringBot/1.0 (+https://campaign.madeboring.com)";

const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 12_000;

/** Run `fn` over `items`, at most `limit` in flight. Mirrors the pool in
 *  tiktokAudioUsage; results go wherever `fn` puts them. */
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

async function fetchAudioPage(audioId: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(instagramAudioPageUrl(audioId), {
      headers: {
        "user-agent": USER_AGENT,
        /* Without this the count string comes back in whatever language
           Instagram picks for the egress region, and the parser reads English. */
        "accept-language": "en-US,en;q=0.9",
        accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param ids platform audio ids (`TikTokSound.tiktokSoundId` on an INSTAGRAM
 *   row), not our row ids.
 * @returns one entry per DISTINCT id, so two orgs tracking the same audio cost
 *   one request between them.
 */
export async function readInstagramAudioUsage(
  ids: string[],
  options: ReadInstagramAudioOptions = {},
): Promise<Map<string, InstagramAudioOutcome>> {
  const {
    concurrency = DEFAULT_CONCURRENCY,
    deadlineAt,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options;

  const log = createLogger({ context: { reader: "instagram-audio-usage" } });
  const out = new Map<string, InstagramAudioOutcome>();

  const distinct = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (distinct.length === 0) return out;

  const outOfTime = () => deadlineAt !== undefined && Date.now() > deadlineAt;

  await pool(distinct, concurrency, async (id) => {
    if (outOfTime()) {
      out.set(id, { ok: false, reason: "deadline" });
      return;
    }

    const html = await fetchAudioPage(id, timeoutMs);
    if (html === null) {
      out.set(id, { ok: false, reason: "fetch-failed" });
      return;
    }

    const parsed = parseInstagramAudioPage(html);
    switch (parsed.kind) {
      case "reading":
        out.set(id, { ok: true, reading: parsed.reading });
        return;
      case "no-count":
        out.set(id, { ok: false, reason: "no-count" });
        return;
      case "not-found":
        out.set(id, { ok: false, reason: "not-found" });
        return;
      case "unreadable":
        /* Worth a line in the log rather than silence: this is the shape that
           would appear if Instagram stopped serving the OG block to
           non-browsers, and it would otherwise look like a run of bad ids. */
        log.warn("audio page carried no open graph block", { audioId: id, bytes: html.length });
        out.set(id, { ok: false, reason: "unreadable" });
        return;
    }
  });

  return out;
}

/**
 * One audio, for the add-a-tracker path.
 *
 * Separate from the batch call because the caller wants the reason: the front
 * door refuses an audio it could never read, and "no such audio" and "publishes
 * no count" are different sentences to put in front of a person.
 */
export async function readOneInstagramAudio(
  audioId: string,
  options: ReadInstagramAudioOptions = {},
): Promise<InstagramAudioOutcome> {
  const map = await readInstagramAudioUsage([audioId], options);
  return map.get(audioId) ?? { ok: false, reason: "fetch-failed" };
}
