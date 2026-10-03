import { createLogger } from "@/lib/observability/logger";
import { fallbackKillKey, isKilled } from "@/lib/ops/killSwitch";

/**
 * Plan B for YouTube post statistics: the public watch page.
 *
 * Plan A is the Data API -- videos.list, then videos.batchGetStats on its own
 * quota bucket. Both need YOUTUBE_API_KEY and both stop when Google says no.
 * This reads what YouTube prints for any logged-out visitor instead, so a
 * missing key, a revoked key or a refused request still ends in a number.
 *
 * What the page carries, measured 2026-10-03 on a public video from this
 * laptop, and from Vercel Sandbox iad1/cle1/sfo1:
 *   - views:    videoDetails.viewCount ("439442113"), exact; and
 *               videoViewCountRenderer "439,442,113 views", exact.
 *               Sandbox egress gets a LOGIN_REQUIRED player with no
 *               videoDetails, but the renderer is still there.
 *   - likes:    the like button's label, "like this video along with
 *               19,982,100 other people", exact. The 19M factoid beside it is
 *               rounded and is never read.
 *   - comments: the comments panel's header -- exact below the point where
 *               YouTube starts abbreviating, "10M" above it. An abbreviated
 *               figure is not a count and is left unread.
 *   - postedAt: microformat publishDate, ISO with offset.
 * sin1 Sandbox egress answered 429 on the same day, so a run from Singapore
 * may get nothing at all; that is a "platform-challenged" answer, not zero.
 *
 * Nothing here ever decides a post is gone. A watch page that says "Video
 * unavailable" is also what a regional block or a bot check looks like, and the
 * Data API, when it is back, settles deletion. Every failure is a non-verdict.
 *
 * Off switch: "source:youtube-watch-page" on the ops page (no redeploy), or
 * YOUTUBE_WATCH_PAGE_FALLBACK=off. "source:youtube" stops it along with plan A.
 */

export const WATCH_PAGE_ENV = "YOUTUBE_WATCH_PAGE_FALLBACK";
export const WATCH_PAGE_KILL_KEY = fallbackKillKey("youtube-watch-page");
export const WATCH_PAGE_TIMEOUT_MS = 8000;
/** Watch pages read in parallel by one batch. */
export const WATCH_PAGE_CONCURRENCY = 4;
/** Ceiling per batch call, so a whole library falling through does not become six hundred page loads. */
export const DEFAULT_WATCH_PAGE_MAX_PER_CALL = 150;
/** This many challenges in a row and the rest of the process leaves the page alone for a while. */
export const WATCH_PAGE_CHALLENGE_STREAK = 3;
export const WATCH_PAGE_BACKOFF_MS = 30 * 60 * 1000;

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

const HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "accept-language": "en-US,en;q=0.9",
  /* Skips the EU consent interstitial, which carries none of the numbers. */
  cookie: "CONSENT=YES+cb; SOCS=CAI",
};

export type WatchPageCounts = {
  viewsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  postedAt?: Date;
};

export type WatchPageRead =
  | { ok: true; counts: WatchPageCounts }
  | { ok: false; reason: "platform-challenged" | "platform-refused" | "no-counts-published" | "backing-off" | "not-configured" };

/** Pure: "19,982,100" -> 19982100; anything abbreviated or empty -> undefined. */
export function exactCount(raw: string | undefined | null): number | undefined {
  if (raw === undefined || raw === null) return undefined;
  const s = raw.trim();
  if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(s)) return undefined;
  const n = Number(s.replace(/,/g, ""));
  return Number.isSafeInteger(n) ? n : undefined;
}

/**
 * Pure: the counts on one watch page, or null when it carries none.
 *
 * Views come from whichever of the two exact fields is larger, because the
 * player's figure and the renderer's can lag each other by a few minutes and a
 * view count only ever goes up.
 */
export function parseWatchPage(html: string): WatchPageCounts | null {
  const views = [
    html.match(/"videoDetails":\{[^]*?"viewCount":"(\d+)"/)?.[1],
    html.match(/"videoViewCountRenderer":\{"viewCount":\{"simpleText":"([\d,]+) views?"/)?.[1],
  ]
    .map(exactCount)
    .filter((n): n is number => n !== undefined);
  const likes = exactCount(html.match(/like this video along with ([\d,]+) other (?:people|person)/)?.[1]);
  const comments =
    exactCount(
      html.match(
        /"panelIdentifier":"engagement-panel-comments-section","header":\{"engagementPanelTitleHeaderRenderer":\{"title":\{"runs":\[\{"text":"Comments"\}\]\},"contextualInfo":\{"runs":\[\{"text":"([^"]*)"/,
      )?.[1],
    ) ?? exactCount(html.match(/"commentCount":\{"simpleText":"([^"]*)"\}/)?.[1]);
  const publish = html.match(/"publishDate":"([^"]+)"/)?.[1];
  const postedAt = publish ? new Date(publish) : undefined;

  const out: WatchPageCounts = {
    ...(views.length ? { viewsCount: Math.max(...views) } : {}),
    ...(likes !== undefined ? { likesCount: likes } : {}),
    ...(comments !== undefined ? { commentsCount: comments } : {}),
    ...(postedAt && !Number.isNaN(postedAt.getTime()) ? { postedAt } : {}),
  };
  const anyCount = out.viewsCount !== undefined || out.likesCount !== undefined || out.commentsCount !== undefined;
  return anyCount ? out : null;
}

/** Pure: whether a page is YouTube refusing us rather than describing a video. */
export function isChallengePage(status: number, finalUrl: string, html: string): boolean {
  if (status === 429) return true;
  if (/\/sorry\/|consent\.youtube\.com|consent\.google\.com/.test(finalUrl)) return true;
  return /"status":"LOGIN_REQUIRED"[^]{0,400}Sign in to confirm/.test(html) && !/"videoViewCountRenderer"/.test(html);
}

export function watchPageEnabledByEnv(env: Record<string, string | undefined> = process.env): boolean {
  return (env[WATCH_PAGE_ENV] ?? "").trim().toLowerCase() !== "off";
}

export function watchPageMaxPerCall(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.YOUTUBE_WATCH_PAGE_MAX_PER_CALL);
  return Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_WATCH_PAGE_MAX_PER_CALL;
}

/* Per process: a run of challenges means this egress is being turned away, and
   asking again for every remaining post only deepens it. */
let challengeStreak = 0;
let backoffUntil = 0;

/** For tests. */
export function resetWatchPageState() {
  challengeStreak = 0;
  backoffUntil = 0;
}

const log = () => createLogger({ context: { platform: "YOUTUBE", call: "watchPage" } });

/** Whether plan B may run now: env, the ops switch, and the challenge backoff. */
export async function watchPageAvailable(
  nowMs = Date.now(),
  env: Record<string, string | undefined> = process.env,
): Promise<WatchPageRead | null> {
  if (!watchPageEnabledByEnv(env)) return { ok: false, reason: "not-configured" };
  if (await isKilled(WATCH_PAGE_KILL_KEY, nowMs)) return { ok: false, reason: "not-configured" };
  if (backoffUntil > nowMs) return { ok: false, reason: "backing-off" };
  return null;
}

/** One watch page. Never throws. */
export async function readYouTubeWatchPage(
  videoId: string,
  { nowMs = Date.now(), env = process.env, fetchImpl = fetch }: { nowMs?: number; env?: Record<string, string | undefined>; fetchImpl?: typeof fetch } = {},
): Promise<WatchPageRead> {
  const closed = await watchPageAvailable(nowMs, env);
  if (closed) return closed;
  if (!VIDEO_ID.test(videoId)) return { ok: false, reason: "platform-refused" };

  let status = 0;
  let finalUrl = "";
  let html = "";
  try {
    const res = await fetchImpl(`https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US`, {
      headers: HEADERS,
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(WATCH_PAGE_TIMEOUT_MS),
    });
    status = res.status;
    finalUrl = res.url || "";
    html = await res.text();
  } catch (e) {
    log().warn("watch page fetch failed", { error: e instanceof Error ? e.message : String(e) });
    return { ok: false, reason: "platform-refused" };
  }

  if (isChallengePage(status, finalUrl, html)) {
    challengeStreak += 1;
    if (challengeStreak >= WATCH_PAGE_CHALLENGE_STREAK) {
      backoffUntil = nowMs + WATCH_PAGE_BACKOFF_MS;
      challengeStreak = 0;
      log().warn("watch pages are being challenged; plan B paused", {
        status,
        until: new Date(backoffUntil).toISOString(),
      });
    }
    return { ok: false, reason: "platform-challenged" };
  }
  challengeStreak = 0;
  if (status >= 400) return { ok: false, reason: "platform-refused" };

  const counts = parseWatchPage(html);
  /* A 200 with nothing parsable is either a removed video or a page YouTube
     restructured. Both are non-verdicts here; "no-counts-published" is the
     reason the canary watches for the second. */
  return counts ? { ok: true, counts } : { ok: false, reason: "no-counts-published" };
}

/**
 * Several watch pages, WATCH_PAGE_CONCURRENCY at a time, at most
 * watchPageMaxPerCall() of them. Ids past the ceiling, or still queued when
 * the backoff starts, are reported as not tried so the caller keeps whatever
 * answer it already had for them.
 */
export async function readYouTubeWatchPages(
  videoIds: string[],
  opts: { env?: Record<string, string | undefined>; fetchImpl?: typeof fetch; deadlineMs?: number } = {},
): Promise<Map<string, WatchPageRead>> {
  const out = new Map<string, WatchPageRead>();
  const env = opts.env ?? process.env;
  const ids = [...new Set(videoIds)].slice(0, watchPageMaxPerCall(env));
  if (ids.length === 0) return out;
  if (await watchPageAvailable(Date.now(), env)) return out;

  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      if (opts.deadlineMs && Date.now() >= opts.deadlineMs) return;
      if (backoffUntil > Date.now()) return;
      const id = ids[next++];
      out.set(id, await readYouTubeWatchPage(id, { env, fetchImpl: opts.fetchImpl }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(WATCH_PAGE_CONCURRENCY, ids.length) }, worker));

  const read = [...out.values()].filter((r) => r.ok).length;
  log().info("post stats read through watch pages", { asked: ids.length, tried: out.size, read });
  return out;
}
