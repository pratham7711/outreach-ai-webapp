import { fetchInstagramMetricsGraph } from "./instagram";
import {
  businessDiscoveryToken,
  fetchInstagramPublicPostMetrics,
} from "./instagramBusinessDiscovery";
import { createLogger } from "../observability/logger";

export type FetchMetricsContext = {
  instagramToken?: string;
  instagramHandle?: string;
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

export async function fetchTikTokMetrics(url: string): Promise<Partial<PostMetrics>> {
  const viaSocialKit = await fetchTikTokMetricsSocialKit(url);
  if (viaSocialKit) return viaSocialKit;
  return fetchTikTokOEmbed(url);
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
      metrics = await fetchTikTokMetrics(url);
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
