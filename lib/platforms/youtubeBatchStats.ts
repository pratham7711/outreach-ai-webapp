import { createLogger } from "@/lib/observability/logger";
import { pacificDay, quotaAllows, quotaUnitsUsed, recordQuota } from "@/lib/ops/quotaDay";

/**
 * YouTube's videos.batchGetStats, as the fallback for post statistics when
 * videos.list has run out of quota (plan §13 B).
 *
 * Read off the official reference on 2026-10-02
 * (developers.google.com/youtube/v3/docs/videos/batchGetStats, and the
 * 2026-06-03 entry of the revision history): GET videos:batchGetStats with `id`
 * (comma-separated) and `part` (contentDetails, id, snippet, statistics); a
 * call costs 1 unit "in its own granular quota bucket", 10,000 units a day by
 * default; public videos need only an API key. The response carries
 * statistics.{viewCount,likeCount,commentCount} and snippet.publishTime --
 * no title and no thumbnail, so a post read through here keeps the ones it
 * has. The reference states no ceiling on ids per call; 50, videos.list's
 * measured ceiling, is used until one is measured.
 *
 * Its own quota is why it is worth having: when videos.list is out for the
 * day, this bucket is untouched. It is counted per Pacific day (YouTube's
 * quota day) in OpsQuotaDay, and calls stop at YOUTUBE_BATCH_STATS_DAILY_UNITS.
 * An unknown count (no table yet) allows the call -- YouTube enforces the real
 * limit either way; the counter is there so it is seen, and so a run does not
 * keep knocking once the bucket is spent.
 *
 * Nothing here decides a post is gone. A video this does not return is left
 * unread, never "deleted": the reference does not say what a failed id means,
 * and the next videos.list read, after the reset, settles it.
 */

export const BATCH_STATS_URL = "https://www.googleapis.com/youtube/v3/videos:batchGetStats";
export const BATCH_STATS_BUCKET = "youtube.batchGetStats";
export const VIDEOS_LIST_BUCKET = "youtube.videos.list";
export const BATCH_STATS_UNIT_COST = 1;
export const DEFAULT_BATCH_STATS_DAILY_UNITS = 10_000;
export const BATCH_STATS_MAX_IDS = 50;
const REQUEST_TIMEOUT_MS = 8000;

export function batchStatsDailyUnits(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.YOUTUBE_BATCH_STATS_DAILY_UNITS);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_BATCH_STATS_DAILY_UNITS;
}

/** One entry of the response's items[], as much of it as is read. */
export type BatchStatItem = {
  id?: string;
  snippet?: { publishTime?: string };
  statistics?: { viewCount?: string | number; likeCount?: string | number; commentCount?: string | number };
};

/**
 * Pure: whether a Data API error is the daily quota running out. 403 with
 * reason quotaExceeded (or the older dailyLimitExceeded); a 403 for anything
 * else -- a key restriction, a forbidden video -- is not a quota problem and
 * must not send reads elsewhere.
 */
export function isQuotaExceeded(status: number, body: string): boolean {
  if (status !== 403) return false;
  try {
    const errors: unknown = JSON.parse(body)?.error?.errors;
    if (!Array.isArray(errors)) return false;
    return errors.some((e) => e?.reason === "quotaExceeded" || e?.reason === "dailyLimitExceeded");
  } catch {
    return false;
  }
}

const log = () => createLogger({ context: { platform: "YOUTUBE", call: "batchGetStats" } });

/* Per process: once videos.list has said the day's quota is gone, asking it
   again before the Pacific midnight reset only spends a request to hear the
   same 403. Likewise for batchGetStats' own bucket. */
let videosListOutDay: string | null = null;
let batchStatsOutDay: string | null = null;

/** For tests. */
export function resetYouTubeQuotaState() {
  videosListOutDay = null;
  batchStatsOutDay = null;
}

export function videosListExhausted(nowMs = Date.now()): boolean {
  return videosListOutDay === pacificDay(nowMs);
}

export async function markVideosListExhausted(nowMs = Date.now()): Promise<void> {
  const day = pacificDay(nowMs);
  if (videosListOutDay === day) return;
  videosListOutDay = day;
  log().warn("videos.list is out of quota until midnight Pacific; post stats now read through videos.batchGetStats", {
    day,
  });
  await recordQuota(day, VIDEOS_LIST_BUCKET, { quotaErrors: 1 });
}

export type BatchStatsResult = {
  /** Videos the call answered for, by id. */
  items: Map<string, BatchStatItem>;
  /** Asked for and not answered: refused by the cap, out of quota, failed, or not returned. */
  unread: string[];
};

/**
 * Statistics for these videos through videos.batchGetStats, 50 ids a call,
 * counted against its own daily bucket. Never throws.
 */
export async function fetchYouTubeBatchStats(
  videoIds: string[],
  apiKey: string,
  { nowMs = Date.now(), env = process.env }: { nowMs?: number; env?: Record<string, string | undefined> } = {},
): Promise<BatchStatsResult> {
  const ids = [...new Set(videoIds.filter((id) => typeof id === "string" && id.length > 0))];
  const result: BatchStatsResult = { items: new Map(), unread: [] };
  if (ids.length === 0) return result;

  const day = pacificDay(nowMs);
  const cap = batchStatsDailyUnits(env);

  for (let i = 0; i < ids.length; i += BATCH_STATS_MAX_IDS) {
    const chunk = ids.slice(i, i + BATCH_STATS_MAX_IDS);
    if (batchStatsOutDay === day) {
      result.unread.push(...chunk);
      continue;
    }
    const used = await quotaUnitsUsed(day, BATCH_STATS_BUCKET);
    if (!quotaAllows(used, cap, BATCH_STATS_UNIT_COST)) {
      log().warn("batchGetStats daily units spent; not calling", { day, used, cap });
      await recordQuota(day, BATCH_STATS_BUCKET, { refused: 1 });
      result.unread.push(...chunk);
      continue;
    }

    const url = new URL(BATCH_STATS_URL);
    url.searchParams.set("part", "statistics,snippet");
    url.searchParams.set("id", chunk.join(","));
    url.searchParams.set("key", apiKey);

    let res: Response;
    try {
      res = await fetch(url.toString(), {
        cache: "no-store",
        signal: typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(REQUEST_TIMEOUT_MS) : undefined,
      });
    } catch (err) {
      /* Sent or not, it may have been billed; the count errs towards spent. */
      await recordQuota(day, BATCH_STATS_BUCKET, { units: BATCH_STATS_UNIT_COST, calls: 1 });
      log().error("batchGetStats request threw", { count: chunk.length, error: err instanceof Error ? err.message : String(err) });
      result.unread.push(...chunk);
      continue;
    }
    /* YouTube charges a refused request too, so every answered call counts. */
    await recordQuota(day, BATCH_STATS_BUCKET, { units: BATCH_STATS_UNIT_COST, calls: 1 });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (isQuotaExceeded(res.status, body)) {
        batchStatsOutDay = day;
        await recordQuota(day, BATCH_STATS_BUCKET, { quotaErrors: 1 });
      }
      log().error("batchGetStats request failed", { status: res.status, count: chunk.length, reason: body.slice(0, 300) });
      result.unread.push(...chunk);
      continue;
    }

    let data: { items?: BatchStatItem[] } | null = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const wanted = new Set(chunk);
    for (const item of data?.items ?? []) {
      if (typeof item?.id === "string" && wanted.has(item.id)) result.items.set(item.id, item);
    }
    for (const id of chunk) if (!result.items.has(id)) result.unread.push(id);
  }
  return result;
}
