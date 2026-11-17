import {
  parseYouTubeSourcePage,
  youtubeSourcePageUrl,
  type YouTubeSourceReading,
} from "@/lib/platforms/youtubeSourcePage";
import { createLogger } from "@/lib/observability/logger";

/**
 * How many Shorts use a YouTube audio, for a set of sources at once.
 *
 * The same shape as readInstagramAudioUsage -- ids in, one entry per distinct
 * id out, a bounded pool, a deadline that reports `deadline` rather than
 * failure -- so the sweep treats the two page readers alike. One public GET of
 * youtube.com/source/<id>/shorts per audio; see lib/platforms/youtubeSourcePage
 * for the page shapes and why an absent count is never written as zero.
 */

export type YouTubeAudioFailure = "not-found" | "no-count" | "unreadable" | "fetch-failed" | "deadline";

export type YouTubeAudioOutcome =
  | { ok: true; reading: YouTubeSourceReading }
  | { ok: false; reason: YouTubeAudioFailure };

export type ReadYouTubeAudioOptions = {
  concurrency?: number;
  /** Epoch ms. Ids not reached by then come back as `deadline`. */
  deadlineAt?: number;
  timeoutMs?: number;
};

const USER_AGENT = "MadeBoringBot/1.0 (+https://campaign.madeboring.com)";
const DEFAULT_CONCURRENCY = 4;
const DEFAULT_TIMEOUT_MS = 12_000;

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

async function fetchSourcePage(videoId: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(youtubeSourcePageUrl(videoId), {
      headers: {
        "user-agent": USER_AGENT,
        /* The count row is localised ("137K Shorts"); the parser reads English. */
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

export async function readYouTubeAudioUsage(
  ids: string[],
  options: ReadYouTubeAudioOptions = {},
): Promise<Map<string, YouTubeAudioOutcome>> {
  const { concurrency = DEFAULT_CONCURRENCY, deadlineAt, timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const log = createLogger({ context: { reader: "youtube-audio-usage" } });
  const out = new Map<string, YouTubeAudioOutcome>();

  const distinct = [...new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean))];
  if (distinct.length === 0) return out;

  const outOfTime = () => deadlineAt !== undefined && Date.now() > deadlineAt;

  await pool(distinct, concurrency, async (id) => {
    if (outOfTime()) {
      out.set(id, { ok: false, reason: "deadline" });
      return;
    }
    const html = await fetchSourcePage(id, timeoutMs);
    if (html === null) {
      out.set(id, { ok: false, reason: "fetch-failed" });
      return;
    }
    const parsed = parseYouTubeSourcePage(html, id);
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
        log.warn("source page carried no ytInitialData", { videoId: id, bytes: html.length });
        out.set(id, { ok: false, reason: "unreadable" });
        return;
    }
  });

  return out;
}

export async function readOneYouTubeAudio(
  videoId: string,
  options: ReadYouTubeAudioOptions = {},
): Promise<YouTubeAudioOutcome> {
  const map = await readYouTubeAudioUsage([videoId], options);
  return map.get(videoId) ?? { ok: false, reason: "fetch-failed" };
}
