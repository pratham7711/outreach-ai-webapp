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
  engagementRate?: number;
  postedAt: Date;
};

export function hasMetricCounts(m: PostMetrics): boolean {
  return typeof m.viewsCount === "number";
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
  const views = Number(stats.viewCount) || 0;
  const likes = Number(stats.likeCount) || 0;
  const comments = Number(stats.commentCount) || 0;
  return {
    thumbnailUrl: item?.snippet?.thumbnails?.high?.url ?? null,
    caption: item?.snippet?.title ?? null,
    viewsCount: views,
    likesCount: likes,
    commentsCount: comments,
    sharesCount: 0,
    engagementRate: views > 0 ? ((likes + comments) / views) * 100 : 0,
    postedAt: item?.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : new Date(),
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
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
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
    viewsCount: pickCount(stats?.playCount, statsV2?.playCount),
    likesCount: pickCount(stats?.diggCount, statsV2?.diggCount),
    commentsCount: pickCount(stats?.commentCount, statsV2?.commentCount),
    sharesCount: pickCount(stats?.shareCount, statsV2?.shareCount),
    caption: typeof item.desc === "string" && item.desc.length > 0 ? item.desc : null,
    thumbnailUrl: item.video?.cover ?? item.video?.originCover ?? null,
    postedAt: Number.isFinite(createTime) && createTime > 0 ? new Date(createTime * 1000) : null,
  };
}

async function fetchTikTokMetricsDirect(url: string): Promise<Partial<PostMetrics> | null> {
  const log = createLogger({ context: { platform: "TIKTOK", url } });

  if (!(await tiktokGate.acquire())) {
    log.warn("TikTok direct fetch skipped; breaker open");
    return null;
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
      return null;
    }

    const parsed = parseTikTokRehydration(await res.text());
    if (!parsed) {
      tiktokGate.recordBlocked();
      log.warn("TikTok direct fetch could not parse rehydration payload");
      return null;
    }
    tiktokGate.recordSuccess();

    const views = parsed.viewsCount;
    const likes = parsed.likesCount;
    const comments = parsed.commentsCount;
    return {
      thumbnailUrl: parsed.thumbnailUrl,
      caption: parsed.caption,
      viewsCount: views,
      likesCount: likes,
      commentsCount: comments,
      sharesCount: parsed.sharesCount,
      engagementRate: views > 0 ? ((likes + comments) / views) * 100 : 0,
      postedAt: parsed.postedAt ?? undefined,
    };
  } catch (err) {
    tiktokGate.recordBlocked();
    log.error("TikTok direct fetch threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
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

    const views = Number(data.views) || 0;
    const likes = Number(data.likes) || 0;
    const comments = Number(data.comments) || 0;
    const shares = Number(data.shares) || 0;

    return {
      thumbnailUrl: data.thumbnailUrl ?? null,
      caption: data.title ?? data.description ?? null,
      viewsCount: views,
      likesCount: likes,
      commentsCount: comments,
      sharesCount: shares,
      engagementRate: views > 0 ? ((likes + comments) / views) * 100 : 0,
      postedAt: data.publishedAt ? new Date(data.publishedAt) : new Date(),
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
        viewsCount: graph.viewsCount,
        likesCount: graph.likesCount,
        commentsCount: graph.commentsCount,
        sharesCount: 0,
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
        viewsCount: post.viewsCount,
        likesCount: post.likesCount,
        commentsCount: post.commentsCount,
        sharesCount: 0,
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
  return {
    thumbnailUrl: null,
    caption: null,
    postedAt: new Date(),
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
    postedAt: m.postedAt ?? new Date(),
  };

  const finite = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const views = finite(m.viewsCount);
  const likes = finite(m.likesCount);
  const comments = finite(m.commentsCount);
  const shares = finite(m.sharesCount);
  const engagement = finite(m.engagementRate);
  if (views !== undefined) result.viewsCount = views;
  if (likes !== undefined) result.likesCount = likes;
  if (comments !== undefined) result.commentsCount = comments;
  if (shares !== undefined) result.sharesCount = shares;
  if (engagement !== undefined) result.engagementRate = engagement;

  return result;
}
