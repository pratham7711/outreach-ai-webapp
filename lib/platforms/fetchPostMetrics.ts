type PostMetrics = {
  platform: "TIKTOK" | "INSTAGRAM" | "YOUTUBE";
  platformPostId: string;
  thumbnailUrl: string | null;
  caption: string | null;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  engagementRate: number;
  postedAt: Date;
};

function detectPlatform(url: string): { platform: PostMetrics["platform"]; id: string } | null {
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

async function fetchYouTubeMetrics(videoId: string): Promise<Partial<PostMetrics>> {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return stubMetrics();

  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=${videoId}&key=${apiKey}`,
      { next: { revalidate: 3600 } }
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
      engagementRate: views > 0 ? ((likes + comments) / views) * 100 : 0,
      postedAt: item.snippet?.publishedAt ? new Date(item.snippet.publishedAt) : new Date(),
    };
  } catch {
    return stubMetrics();
  }
}

async function fetchOEmbedMetrics(url: string): Promise<Partial<PostMetrics>> {
  // Try Instagram oEmbed
  if (url.includes("instagram.com")) {
    try {
      const res = await fetch(`https://api.instagram.com/oembed?url=${encodeURIComponent(url)}`);
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
  }

  // Try TikTok oEmbed
  if (url.includes("tiktok.com")) {
    try {
      const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
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
  }

  return stubMetrics();
}

function stubMetrics(): Partial<PostMetrics> {
  return {
    thumbnailUrl: null,
    caption: null,
    viewsCount: 0,
    likesCount: 0,
    commentsCount: 0,
    engagementRate: 0,
    postedAt: new Date(),
  };
}

export async function fetchPostMetrics(url: string): Promise<PostMetrics | null> {
  const detected = detectPlatform(url);
  if (!detected) return null;

  let metrics: Partial<PostMetrics>;

  if (detected.platform === "YOUTUBE") {
    metrics = await fetchYouTubeMetrics(detected.id);
  } else {
    metrics = await fetchOEmbedMetrics(url);
  }

  return {
    platform: detected.platform,
    platformPostId: detected.id,
    thumbnailUrl: metrics.thumbnailUrl ?? null,
    caption: metrics.caption ?? null,
    viewsCount: metrics.viewsCount ?? 0,
    likesCount: metrics.likesCount ?? 0,
    commentsCount: metrics.commentsCount ?? 0,
    engagementRate: metrics.engagementRate ?? 0,
    postedAt: metrics.postedAt ?? new Date(),
  };
}
