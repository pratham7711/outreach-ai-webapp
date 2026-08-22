import { fetchInstagramMetricsGraph } from "./instagram";
import {
  businessDiscoveryToken,
  fetchInstagramPublicPostMetrics,
} from "./instagramBusinessDiscovery";
import { fetchTikTokVideosByIds } from "./tiktokDisplay";
import { createLogger } from "../observability/logger";

export type FetchMetricsContext = {
  instagramToken?: string;
  instagramHandle?: string;
  tiktokToken?: string;
};

export type PostMetrics = {
  platform: "TIKTOK" | "INSTAGRAM" | "YOUTUBE";
  platformPostId: string;
  thumbnailUrl: string | null;
  caption: string | null;
  viewsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  sharesCount?: number;
  /**
   * TikTok publishes this as `collectCount` -- bookmarks, which CreatorCore's
   * report calls Total Saves. We parsed four counters out of that payload for
   * months and left the fifth sitting next to them, so the tile had no source and
   * a campaign with 1,762 saves reported none.
   *
   * Instagram and YouTube publish no equivalent, and no platform we can reach
   * publishes a download count at all, which is why there is no downloadsCount
   * here: a field nothing can ever fill is worse than an absent one.
   */
  savesCount?: number;
  engagementRate?: number;
  /**
   * The post author's follower count, when the payload happened to carry it.
   *
   * Not a property of the post, which is why it is the odd one out here -- but
   * TikTok reports it in the same response as the counters, so a sync that has
   * already paid for the fetch can fill in a creator's followers for free. The
   * campaign roster printed 0 for all 25 creators because nothing had ever
   * written the column.
   */
  authorFollowers?: number;
  /** Absent when the platform did not say. Never today's date as a stand-in. */
  postedAt?: Date;
};

export function hasMetricCounts(m: PostMetrics): boolean {
  if (typeof m.viewsCount !== "number") return false;
  const likesExceedViews = typeof m.likesCount === "number" && m.likesCount > m.viewsCount;
  return !likesExceedViews;
}

function fetchTimeoutSignal(ms = 8000): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}

export function detectPlatform(url: string): { platform: PostMetrics["platform"]; id: string } | null {
  // YouTube: watch?v=ID, youtu.be/ID, shorts/ID, live/ID, embed/ID (IDs are 11 chars).
  // Host-guarded so a stray ?v= on another domain can't be misread as YouTube.
  if (/(?:youtube\.com|youtu\.be)/.test(url)) {
    const ytMatch =
      url.match(/(?:youtube\.com\/(?:shorts|live|embed)\/|youtu\.be\/)([\w-]{11})/) ||
      url.match(/[?&]v=([\w-]{11})/);
    if (ytMatch) return { platform: "YOUTUBE", id: ytMatch[1] };
  }

  // TikTok: tiktok.com/@user/video/ID
  const ttMatch = url.match(/tiktok\.com\/@[\w.]+\/video\/(\d+)/);
  if (ttMatch) return { platform: "TIKTOK", id: ttMatch[1] };

  // Instagram: instagram.com/reel/CODE or instagram.com/p/CODE
  const igMatch = url.match(/instagram\.com\/(?:reel|p)\/([\w-]+)/);
  if (igMatch) return { platform: "INSTAGRAM", id: igMatch[1] };

  return null;
}

export async function fetchYouTubeMetrics(videoId: string): Promise<Partial<PostMetrics>> {
  const log = createLogger({ context: { platform: "YOUTUBE", videoId } });
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    log.warn("YOUTUBE_API_KEY not set; storing no metric counts for this post");
    return stubMetrics();
  }

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoId}&key=${apiKey}`,
      { next: { revalidate: 3600 }, signal: fetchTimeoutSignal() }
    );
    if (!res.ok) {
      const reason = await res.text().catch(() => "");
      log.error("YouTube API request failed", { status: res.status, reason: reason.slice(0, 300) });
      return stubMetrics();
    }

    const data = await res.json();
    const item = data.items?.[0];
    if (!item) {
      log.warn("YouTube API returned no video (deleted, private, or invalid id)");
      return stubMetrics();
    }
    return mapYouTubeItem(item);
  } catch (err) {
    log.error("YouTube API fetch threw", { error: err instanceof Error ? err.message : String(err) });
    return stubMetrics();
  }
}

function mapYouTubeItem(item: any): Partial<PostMetrics> {
  const stats = item?.statistics ?? {};
  const views = pickOptionalCount(stats.viewCount);
  const likes = pickOptionalCount(stats.likeCount);
  const comments = pickOptionalCount(stats.commentCount);
  const published = item?.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : undefined;
  /* No sharesCount: the Data API has no share statistic at all, so the zero
     this used to write was a reading nobody ever took. A channel that hides its
     like count omits likeCount for the same reason, and Number(undefined) || 0
     turned that into a measured none too. */
  return {
    thumbnailUrl: item?.snippet?.thumbnails?.high?.url ?? null,
    caption: item?.snippet?.title ?? null,
    ...(views !== undefined ? { viewsCount: views } : {}),
    ...(likes !== undefined ? { likesCount: likes } : {}),
    ...(comments !== undefined ? { commentsCount: comments } : {}),
    ...(views !== undefined && views > 0
      ? { engagementRate: (((likes ?? 0) + (comments ?? 0)) / views) * 100 }
      : {}),
    ...(published && !Number.isNaN(published.getTime()) ? { postedAt: published } : {}),
  };
}

export async function fetchYouTubeMetricsBatch(videoIds: string[]): Promise<Map<string, PostMetrics>> {
  const out = new Map<string, PostMetrics>();
  const ids = [...new Set(videoIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return out;

  const log = createLogger({ context: { platform: "YOUTUBE", mode: "batch" } });
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    log.warn("YOUTUBE_API_KEY not set; batch skipped", { count: ids.length });
    return out;
  }

  for (let i = 0; i < ids.length; i += 50) {
    const chunk = ids.slice(i, i + 50);
    try {
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${chunk
          .map((id) => encodeURIComponent(id))
          .join(",")}&key=${apiKey}`,
        { next: { revalidate: 3600 }, signal: fetchTimeoutSignal() },
      );
      if (!res.ok) {
        const reason = await res.text().catch(() => "");
        log.error("YouTube batch request failed", {
          status: res.status,
          count: chunk.length,
          reason: reason.slice(0, 300),
        });
        continue;
      }
      const data = await res.json();
      const returned = new Set<string>();
      for (const item of data.items ?? []) {
        if (typeof item?.id !== "string") continue;
        returned.add(item.id);
        out.set(item.id, assemblePostMetrics("YOUTUBE", item.id, mapYouTubeItem(item)));
      }
      for (const id of chunk) {
        if (!returned.has(id)) out.set(id, assemblePostMetrics("YOUTUBE", id, stubMetrics()));
      }
    } catch (err) {
      log.error("YouTube batch fetch threw", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

export async function fetchTikTokMetrics(
  url: string,
  videoId?: string,
  accessToken?: string,
): Promise<Partial<PostMetrics>> {
  if (videoId && accessToken) {
    const viaDisplay = await fetchTikTokMetricsDisplay(videoId, accessToken);
    if (viaDisplay) return viaDisplay;
  }
  const viaDirect = await fetchTikTokMetricsDirect(url);
  if (viaDirect) return viaDirect;
  const viaSocialKit = await fetchTikTokMetricsSocialKit(url);
  if (viaSocialKit) return viaSocialKit;
  return fetchTikTokOEmbed(url);
}

// video.query only returns posts owned by the token's account, so a post by a
// different creator falls through to the paid/oEmbed paths below.
async function fetchTikTokMetricsDisplay(
  videoId: string,
  accessToken: string,
): Promise<Partial<PostMetrics> | null> {
  const videos = await fetchTikTokVideosByIds(accessToken, [videoId]);
  const video = videos.find((v) => v.id === videoId);
  if (!video) return null;

  const views = video.viewsCount;
  const likes = video.likesCount;
  const comments = video.commentsCount;
  return {
    thumbnailUrl: video.coverImageUrl,
    caption: video.description || video.title || null,
    viewsCount: views,
    likesCount: likes,
    commentsCount: comments,
    sharesCount: video.sharesCount,
    engagementRate: views > 0 ? ((likes + comments) / views) * 100 : 0,
    postedAt: new Date(video.postedAt),
  };
}

export type TikTokDirectMetrics = {
  /* Optional, because every field in TikTok's stats block is. A missing one used
     to arrive here as 0 and be written as a measured zero. */
  viewsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  sharesCount?: number;
  /** The post author's follower count, which the same payload reports under
   *  authorStats -- free, since we have already paid for this fetch. */
  authorFollowers?: number;
  /** TikTok's collectCount: bookmarks, which the client report calls saves. */
  savesCount?: number;
  caption: string | null;
  thumbnailUrl: string | null;
  postedAt: Date | null;
};

export const TIKTOK_REHYDRATION_RE =
  /<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/;

export const TIKTOK_DIRECT_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export type RateGateOptions = {
  minGapMs: number;
  jitterMs: number;
  breakerThreshold: number;
  breakerCooldownMs: number;
};

export type RateGate = {
  acquire: () => Promise<boolean>;
  recordSuccess: () => void;
  recordBlocked: () => void;
  isOpen: (now?: number) => boolean;
};

export function createRateGate(options: RateGateOptions): RateGate {
  let nextAllowedAt = 0;
  let consecutiveBlocked = 0;
  let breakerUntil = 0;

  function isOpen(now = Date.now()): boolean {
    return now < breakerUntil;
  }

  return {
    isOpen,
    async acquire() {
      const now = Date.now();
      if (isOpen(now)) return false;

      const waitMs = Math.max(0, nextAllowedAt - now);
      const gap = options.minGapMs + Math.floor(Math.random() * options.jitterMs);
      nextAllowedAt = Math.max(now, nextAllowedAt) + gap;
      if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
      return true;
    },
    recordSuccess() {
      consecutiveBlocked = 0;
    },
    recordBlocked() {
      consecutiveBlocked += 1;
      if (consecutiveBlocked >= options.breakerThreshold) {
        breakerUntil = Date.now() + options.breakerCooldownMs;
        consecutiveBlocked = 0;
      }
    },
  };
}

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

const tiktokGate = createRateGate({
  minGapMs: envInt("TIKTOK_FETCH_MIN_GAP_MS", 1500),
  jitterMs: envInt("TIKTOK_FETCH_JITTER_MS", 600),
  breakerThreshold: envInt("TIKTOK_FETCH_BREAKER_THRESHOLD", 5),
  breakerCooldownMs: envInt("TIKTOK_FETCH_BREAKER_COOLDOWN_MS", 15 * 60 * 1000),
});

export function isBlockedStatus(status: number): boolean {
  return status === 403 || status === 429 || status >= 500;
}

export function pickCount(...values: unknown[]): number {
  let best = 0;
  for (const value of values) {
    const n = Number(value);
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best;
}

/**
 * The same, but absent stays absent.
 *
 * pickCount answers 0 when nothing was numeric, which reads downstream as a
 * counter we measured at zero -- and every field in TikTok's stats block is
 * optional, so a payload missing one would have been recorded as a real zero.
 * See fieldMetricValue in lib/metricDisplay for what depends on the difference.
 */
export function pickOptionalCount(...values: unknown[]): number | undefined {
  let best: number | undefined;
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const n = Number(value);
    if (Number.isFinite(n) && (best === undefined || n > best)) best = n;
  }
  return best;
}

// TikTok answers a deleted post with a normal 200 and a rehydration payload
// carrying a non-zero statusCode (10204 "item doesn't exist"). That is a
// perfectly healthy response, so callers must not mistake it for being blocked.
// Returns null when there is no payload at all, which IS the blocked/changed
// -markup case.
export function parseTikTokDetailStatus(html: string): number | null {
  const match = html.match(TIKTOK_REHYDRATION_RE);
  if (!match) return null;

  try {
    const detail = JSON.parse(match[1])?.__DEFAULT_SCOPE__?.["webapp.video-detail"];
    if (!detail) return null;
    return typeof detail.statusCode === "number" ? detail.statusCode : null;
  } catch {
    return null;
  }
}

export function parseTikTokRehydration(html: string): TikTokDirectMetrics | null {
  const match = html.match(TIKTOK_REHYDRATION_RE);
  if (!match) return null;

  let payload: any;
  try {
    payload = JSON.parse(match[1]);
  } catch {
    return null;
  }

  const detail = payload?.__DEFAULT_SCOPE__?.["webapp.video-detail"];
  if (!detail) return null;
  if (typeof detail.statusCode === "number" && detail.statusCode !== 0) return null;

  const item = detail.itemInfo?.itemStruct;
  const stats = item?.stats;
  const statsV2 = item?.statsV2;
  if (!item || (!stats && !statsV2)) return null;

  const createTime = Number(item.createTime);

  return {
    viewsCount: pickOptionalCount(stats?.playCount, statsV2?.playCount),
    likesCount: pickOptionalCount(stats?.diggCount, statsV2?.diggCount),
    commentsCount: pickOptionalCount(stats?.commentCount, statsV2?.commentCount),
    sharesCount: pickOptionalCount(stats?.shareCount, statsV2?.shareCount),
    savesCount: pickOptionalCount(stats?.collectCount, statsV2?.collectCount),
    authorFollowers: pickOptionalCount(
      item?.authorStats?.followerCount,
      item?.authorStatsV2?.followerCount
    ),
    caption: typeof item.desc === "string" && item.desc.length > 0 ? item.desc : null,
    thumbnailUrl: item.video?.cover ?? item.video?.originCover ?? null,
    postedAt: Number.isFinite(createTime) && createTime > 0 ? new Date(createTime * 1000) : null,
  };
}

/**
 * What TikTok told us about a post, as opposed to merely whether we got counts.
 *
 * - `live`        the post exists and `metrics` is populated
 * - `deleted`     TikTok answered normally and said the item is gone
 * - `unavailable` we could not get a usable answer: blocked, rate-gated,
 *                 timed out, or the page shape changed. Says nothing about
 *                 whether the post exists.
 */
export type TikTokPostState = "live" | "deleted" | "unavailable";

export type TikTokPostLookup = {
  state: TikTokPostState;
  /** TikTok's own status code when it gave us one. 0 means live. */
  statusCode: number | null;
  /** Why we could not tell, for `unavailable` only. */
  reason: string | null;
  metrics: TikTokDirectMetrics | null;
};

export async function lookupTikTokPost(url: string): Promise<TikTokPostLookup> {
  const log = createLogger({ context: { platform: "TIKTOK", url } });

  if (!(await tiktokGate.acquire())) {
    log.warn("TikTok direct fetch skipped; breaker open");
    return { state: "unavailable", statusCode: null, reason: "breaker-open", metrics: null };
  }

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": TIKTOK_DIRECT_UA,
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: fetchTimeoutSignal(15000),
    });
    if (!res.ok) {
      if (isBlockedStatus(res.status)) tiktokGate.recordBlocked();
      else tiktokGate.recordSuccess();
      log.warn("TikTok direct fetch returned non-OK", { status: res.status });
      return {
        state: "unavailable",
        statusCode: null,
        reason: `http-${res.status}`,
        metrics: null,
      };
    }

    const html = await res.text();
    const parsed = parseTikTokRehydration(html);
    if (!parsed) {
      // A removed post answers 200 with a non-zero statusCode. Counting that as
      // a block let five deleted posts in a row latch the breaker for 15
      // minutes and stall every healthy fetch behind them.
      const statusCode = parseTikTokDetailStatus(html);
      if (statusCode !== null && statusCode !== 0) {
        tiktokGate.recordSuccess();
        log.warn("TikTok says this post is gone", { statusCode });
        return { state: "deleted", statusCode, reason: null, metrics: null };
      }
      tiktokGate.recordBlocked();
      log.warn("TikTok direct fetch could not parse rehydration payload");
      return {
        state: "unavailable",
        statusCode: null,
        reason: "no-parsable-payload",
        metrics: null,
      };
    }

    tiktokGate.recordSuccess();
    return { state: "live", statusCode: 0, reason: null, metrics: parsed };
  } catch (err) {
    tiktokGate.recordBlocked();
    log.error("TikTok direct fetch threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      state: "unavailable",
      statusCode: null,
      reason: err instanceof Error ? err.name : "fetch-threw",
      metrics: null,
    };
  }
}

export function tiktokMetricsToPartial(parsed: TikTokDirectMetrics): Partial<PostMetrics> {
  const views = parsed.viewsCount;
  const likes = parsed.likesCount;
  const comments = parsed.commentsCount;
  /* Only the fields TikTok sent, so an absent counter stays absent all the way
     to the write -- see countsFrom in lib/sync/syncPost. */
  return {
    thumbnailUrl: parsed.thumbnailUrl,
    caption: parsed.caption,
    ...(typeof views === "number" ? { viewsCount: views } : {}),
    ...(typeof likes === "number" ? { likesCount: likes } : {}),
    ...(typeof comments === "number" ? { commentsCount: comments } : {}),
    ...(typeof parsed.sharesCount === "number" ? { sharesCount: parsed.sharesCount } : {}),
    ...(typeof parsed.savesCount === "number" ? { savesCount: parsed.savesCount } : {}),
    ...(typeof parsed.authorFollowers === "number" ? { authorFollowers: parsed.authorFollowers } : {}),
    ...(typeof views === "number" && views > 0
      ? { engagementRate: (((likes ?? 0) + (comments ?? 0)) / views) * 100 }
      : {}),
    postedAt: parsed.postedAt ?? undefined,
  };
}

async function fetchTikTokMetricsDirect(url: string): Promise<Partial<PostMetrics> | null> {
  const lookup = await lookupTikTokPost(url);
  return lookup.metrics ? tiktokMetricsToPartial(lookup.metrics) : null;
}

async function fetchTikTokMetricsSocialKit(url: string): Promise<Partial<PostMetrics> | null> {
  const log = createLogger({ context: { platform: "TIKTOK", url } });
  const apiKey = process.env.SOCIALKIT_API_KEY;
  if (!apiKey) {
    log.debug("SOCIALKIT_API_KEY not set; falling back to oEmbed (no metric counts)");
    return null;
  }

  try {
    const endpoint = `https://api.socialkit.dev/tiktok/stats?access_key=${encodeURIComponent(
      apiKey,
    )}&url=${encodeURIComponent(url)}`;
    const res = await fetch(endpoint, {
      next: { revalidate: 3600 },
      signal: fetchTimeoutSignal(15000),
    });
    if (!res.ok) {
      const reason = await res.text().catch(() => "");
      log.error("SocialKit TikTok stats request failed", {
        status: res.status,
        reason: reason.slice(0, 300),
      });
      return null;
    }

    const json = await res.json();
    const data = json?.data;
    if (json?.success !== true || !data) {
      log.warn("SocialKit returned no data for TikTok video", { success: json?.success });
      return null;
    }

    const views = pickOptionalCount(data.views);
    const likes = pickOptionalCount(data.likes);
    const comments = pickOptionalCount(data.comments);
    const shares = pickOptionalCount(data.shares);
    const published = data.publishedAt ? new Date(data.publishedAt) : undefined;

    return {
      thumbnailUrl: data.thumbnailUrl ?? null,
      caption: data.title ?? data.description ?? null,
      ...(views !== undefined ? { viewsCount: views } : {}),
      ...(likes !== undefined ? { likesCount: likes } : {}),
      ...(comments !== undefined ? { commentsCount: comments } : {}),
      ...(shares !== undefined ? { sharesCount: shares } : {}),
      ...(views !== undefined && views > 0
        ? { engagementRate: (((likes ?? 0) + (comments ?? 0)) / views) * 100 }
        : {}),
      ...(published && !Number.isNaN(published.getTime()) ? { postedAt: published } : {}),
    };
  } catch (err) {
    log.error("SocialKit TikTok fetch threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function fetchTikTokOEmbed(url: string): Promise<Partial<PostMetrics>> {
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: fetchTimeoutSignal(),
    });
    if (res.ok) {
      const data = await res.json();
      return {
        thumbnailUrl: data.thumbnail_url ?? null,
        caption: data.title ?? null,
      };
    }
  } catch {
    // fall through
  }
  return stubMetrics();
}

export async function fetchInstagramMetrics(
  url: string,
  token?: string,
  handle?: string,
): Promise<Partial<PostMetrics>> {
  if (token) {
    const graph = await fetchInstagramMetricsGraph(url, token, fetchTimeoutSignal());
    if (graph) {
      return {
        thumbnailUrl: graph.thumbnailUrl,
        caption: graph.caption,
        ...(typeof graph.viewsCount === "number" ? { viewsCount: graph.viewsCount } : {}),
        ...(typeof graph.likesCount === "number" ? { likesCount: graph.likesCount } : {}),
        ...(typeof graph.commentsCount === "number" ? { commentsCount: graph.commentsCount } : {}),
        /* No sharesCount at all. Instagram publishes no share count on any
           endpoint we can reach, so writing 0 asserted a measurement we cannot
           make -- and CreatorCore's report of the same posts shows no shares row
           for them either. */
        postedAt: graph.postedAt,
      };
    }
  }
  const bizToken = businessDiscoveryToken();
  if (bizToken && handle) {
    const post = await fetchInstagramPublicPostMetrics(handle, url, bizToken, fetchTimeoutSignal());
    if (post) {
      return {
        thumbnailUrl: post.thumbnailUrl,
        caption: post.caption,
        ...(typeof post.viewsCount === "number" ? { viewsCount: post.viewsCount } : {}),
        ...(typeof post.likesCount === "number" ? { likesCount: post.likesCount } : {}),
        ...(typeof post.commentsCount === "number" ? { commentsCount: post.commentsCount } : {}),
        ...(typeof post.authorFollowers === "number" ? { authorFollowers: post.authorFollowers } : {}),
        // Same as above: Instagram reports no shares, so we claim none.
        postedAt: post.postedAt ?? undefined,
      };
    }
  }
  try {
    const res = await fetch(`https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`, {
      signal: fetchTimeoutSignal(),
    });
    if (res.ok) {
      const data = await res.json();
      return {
        thumbnailUrl: data.thumbnail_url ?? null,
        caption: data.title ?? null,
      };
    }
  } catch {
    // fall through
  }
  return stubMetrics();
}

function stubMetrics(): Partial<PostMetrics> {
  // No postedAt. A stub is what we return when the platform told us nothing, and
  // it knows least of all when the post went up -- filling in `new Date()` there
  // stamped today onto every post created while TikTok was unreachable, and the
  // reference campaign's seventeen posts all claimed to have been published on
  // the day we added them.
  return {
    thumbnailUrl: null,
    caption: null,
  };
}

export async function fetchPostMetrics(
  url: string,
  context?: FetchMetricsContext,
): Promise<PostMetrics | null> {
  const detected = detectPlatform(url);
  if (!detected) return null;

  let metrics: Partial<PostMetrics>;

  switch (detected.platform) {
    case "YOUTUBE":
      metrics = await fetchYouTubeMetrics(detected.id);
      break;
    case "TIKTOK":
      metrics = await fetchTikTokMetrics(url, detected.id, context?.tiktokToken);
      break;
    case "INSTAGRAM":
      metrics = await fetchInstagramMetrics(url, context?.instagramToken, context?.instagramHandle);
      break;
  }

  return assemblePostMetrics(detected.platform, detected.id, metrics);
}

function assemblePostMetrics(
  platform: PostMetrics["platform"],
  platformPostId: string,
  m: Partial<PostMetrics>,
): PostMetrics {
  const result: PostMetrics = {
    platform,
    platformPostId,
    thumbnailUrl: m.thumbnailUrl ?? null,
    caption: m.caption ?? null,
    ...(m.postedAt ? { postedAt: m.postedAt } : {}),
  };

  const finite = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const views = finite(m.viewsCount);
  const likes = finite(m.likesCount);
  const comments = finite(m.commentsCount);
  const shares = finite(m.sharesCount);
  const saves = finite(m.savesCount);
  const engagement = finite(m.engagementRate);
  if (views !== undefined) result.viewsCount = views;
  if (likes !== undefined) result.likesCount = likes;
  if (comments !== undefined) result.commentsCount = comments;
  if (shares !== undefined) result.sharesCount = shares;
  /* This list is a whitelist, so a counter the parser produces but this omits is
     silently dropped -- which is exactly what happened to saves on its first
     run: parsed from collectCount, and gone by the time anything wrote it. */
  if (saves !== undefined) result.savesCount = saves;
  const followers = finite(m.authorFollowers);
  if (followers !== undefined) result.authorFollowers = followers;
  if (engagement !== undefined) result.engagementRate = engagement;

  return result;
}
