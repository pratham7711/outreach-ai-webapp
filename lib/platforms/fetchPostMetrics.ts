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

function fetchTimeoutSignal(): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(8000)
    : undefined;
}

export function detectPlatform(url: string): { platform: PostMetrics["platform"]; id: string } | null {
  // YouTube: youtube.com/watch?v=ID or youtu.be/ID or youtube.com/shorts/ID
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([\w-]+)/);
  if (ytMatch) return { platform: "YOUTUBE", id: ytMatch[1] };

  // TikTok: tiktok.com/@user/video/ID
  const ttMatch = url.match(/tiktok\.com\/@[\w.]+\/video\/(\d+)/);
  if (ttMatch) return { platform: "TIKTOK", id: ttMatch[1] };

  // Instagram: instagram.com/reel/CODE or instagram.com/p/CODE
  const igMatch = url.match(/instagram\.com\/(?:reel|p)\/([\w-]+)/);
  if (igMatch) return { platform: "INSTAGRAM", id: igMatch[1] };

  return null;
}

export async function fetchYouTubeMetrics(videoId: string): Promise<Partial<PostMetrics>> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return stubMetrics();

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoId}&key=${apiKey}`,
      { next: { revalidate: 3600 }, signal: fetchTimeoutSignal() }
    );
    if (!res.ok) return stubMetrics();

    const data = await res.json();
    const item = data.items?.[0];
    if (!item) return stubMetrics();

    const stats = item.statistics;
    const views = Number(stats.viewCount) || 0;
    const likes = Number(stats.likeCount) || 0;
    const comments = Number(stats.commentCount) || 0;

    return {
      thumbnailUrl: item.snippet?.thumbnails?.high?.url ?? null,
      caption: item.snippet?.title ?? null,
      viewsCount: views,
      likesCount: likes,
      commentsCount: comments,
      sharesCount: 0,
      engagementRate: views > 0 ? ((likes + comments) / views) * 100 : 0,
      postedAt: item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : new Date(),
    };
  } catch {
    return stubMetrics();
  }
}

export async function fetchTikTokMetrics(url: string): Promise<Partial<PostMetrics>> {
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

export async function fetchInstagramMetrics(url: string): Promise<Partial<PostMetrics>> {
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

export async function fetchPostMetrics(url: string): Promise<PostMetrics | null> {
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
      metrics = await fetchInstagramMetrics(url);
      break;
  }

  const result: PostMetrics = {
    platform: detected.platform,
    platformPostId: detected.id,
    thumbnailUrl: metrics.thumbnailUrl ?? null,
    caption: metrics.caption ?? null,
    postedAt: metrics.postedAt ?? new Date(),
  };

  const finite = (v: unknown): number | undefined =>
    typeof v === "number" && Number.isFinite(v) ? v : undefined;
  const views = finite(metrics.viewsCount);
  const likes = finite(metrics.likesCount);
  const comments = finite(metrics.commentsCount);
  const shares = finite(metrics.sharesCount);
  const engagement = finite(metrics.engagementRate);
  if (views !== undefined) result.viewsCount = views;
  if (likes !== undefined) result.likesCount = likes;
  if (comments !== undefined) result.commentsCount = comments;
  if (shares !== undefined) result.sharesCount = shares;
  if (engagement !== undefined) result.engagementRate = engagement;

  return result;
}
