import { fetchInstagramProfile, businessDiscoveryToken } from "./instagramBusinessDiscovery";
import { fetchTikTokProfile } from "./tiktokProfile";

/**
 * Reading a tracked creator's public numbers, per platform.
 *
 * The creator tracker previously computed everything from Post rows already in
 * this database, joined through Campaign.orgId. That limited it to creators we
 * already work with — a watchlist you cannot add a stranger to is not a
 * watchlist — and left Creator.followersCount, populated on 11 of 1,834 rows, as
 * the only follower figure anywhere.
 *
 * Each platform is a different bargain and the differences are not hideable:
 *
 *   Instagram  Business Discovery. Any Business/Creator account, no connection
 *              needed, but personal and private accounts return nothing at all
 *              and always will. That is a permanent property of the account, not
 *              a transient failure, which is why `reason` is carried out of here
 *              rather than collapsed into null.
 *   YouTube    Data API v3, public and generous. Averages the most recent
 *              uploads rather than lifetime views/videos, so the figure means the
 *              same thing it does on the other platforms.
 *   TikTok     No public API exists. Handled by the browser reader, the same way
 *              sound counts already are.
 */

/** One entry in a creator's Top Posts, in the shape the Creator.topPosts JSON
 * column stores. Nullable fields are platform gaps, not parse failures --
 * Instagram omits view_count on stills, YouTube thumbnails can be absent on a
 * just-uploaded video. */
export type TopPost = {
  postId: string;
  url: string | null;
  caption: string | null;
  coverUrl: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** ISO string, so the value survives the JSON column round-trip unchanged. */
  postedAt: string | null;
};

export type CreatorProfileRead = {
  followersCount: number;
  /** Lifetime post count as the platform reports it, not our Post row count. */
  postsCount: number;
  /** Mean views across the recent posts the reader could see. */
  avgViews: number;
  /** How many posts that mean was taken over — 0 means avgViews is not a measurement. */
  sampledPosts: number;
  /** Best recent posts by views, when the read that produced the stats could
   * also see the posts themselves. Absent means "not measured here" -- TikTok
   * stats come from a page that renders no posts -- and the caller must keep
   * whatever it already has rather than erase it. */
  topPosts?: TopPost[];
};

export const TOP_POSTS_LIMIT = 6;

export function rankTopPosts(posts: TopPost[]): TopPost[] {
  /* Views rank first; a post the platform gave no view count for (an Instagram
     still, typically) falls back to likes, which systematically underrates it
     against reels but beats excluding it entirely. */
  return [...posts]
    .sort((a, b) => (b.views ?? b.likes ?? 0) - (a.views ?? a.likes ?? 0))
    .slice(0, TOP_POSTS_LIMIT);
}

/** Why a read produced nothing. Stored on Creator.trackerLastError verbatim. */
export type CreatorReadFailure =
  /** No token/key configured for this platform in this environment. */
  | "no-credentials"
  /** We have no reader for this platform at all. */
  | "unsupported-platform"
  /** Instagram: personal or private account. Permanent until they convert it. */
  | "not-a-professional-account"
  /** The platform answered, but without the numbers we need. */
  | "unreadable"
  /** The platform refused us for now — quota, throttle, or a transient block. */
  | "rate-limited";

export type CreatorReadResult =
  | { ok: true; profile: CreatorProfileRead }
  | { ok: false; reason: CreatorReadFailure; detail?: string };

/** Human copy for the UI. The tracker says why, rather than showing a zero. */
export const READ_FAILURE_COPY: Record<CreatorReadFailure, string> = {
  "no-credentials": "This platform is not connected yet, so we cannot read this creator.",
  "unsupported-platform": "We do not track this platform yet.",
  "not-a-professional-account":
    "Instagram only shares figures for Business and Creator accounts. This one is personal or private.",
  unreadable: "The platform answered but did not include follower or view counts.",
  "rate-limited": "We are reading too many creators right now. This one retries on the next sweep.",
};

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

async function readInstagram(handle: string): Promise<CreatorReadResult> {
  const token = businessDiscoveryToken();
  if (!token) return { ok: false, reason: "no-credentials" };

  let profile;
  try {
    profile = await fetchInstagramProfile(handle, token);
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    // Graph signals throttling with codes 4/17/32; treat those as retryable so a
    // busy hour does not get written down as "this account is personal".
    if (/rate|limit|\(#(4|17|32)\)/i.test(detail)) {
      return { ok: false, reason: "rate-limited", detail };
    }
    return { ok: false, reason: "unreadable", detail };
  }

  /* Business Discovery answers with nothing at all for an account that is not a
     Business or Creator account, which is the overwhelmingly common cause here
     and the one the reader can act on. */
  if (!profile) return { ok: false, reason: "not-a-professional-account" };

  if (profile.followersCount === undefined) {
    return { ok: false, reason: "unreadable", detail: "no followers_count in response" };
  }

  /* Only posts that actually carry a view count feed the mean. Instagram omits
     view_count on stills rather than sending zero, and averaging the absent ones
     in as zero is how a reel-heavy creator gets reported as having no views. */
  const views = profile.recentPosts
    .map((p) => p.viewsCount)
    .filter((v): v is number => typeof v === "number");

  const topPosts = rankTopPosts(
    profile.recentPosts.map((p) => ({
      postId: p.id,
      url: p.permalink,
      caption: p.caption,
      coverUrl: p.thumbnailUrl,
      views: typeof p.viewsCount === "number" ? p.viewsCount : null,
      likes: typeof p.likesCount === "number" ? p.likesCount : null,
      comments: typeof p.commentsCount === "number" ? p.commentsCount : null,
      postedAt: p.postedAt ? p.postedAt.toISOString() : null,
    }))
  );

  return {
    ok: true,
    profile: {
      followersCount: profile.followersCount,
      postsCount: profile.mediaCount ?? 0,
      avgViews: mean(views),
      sampledPosts: views.length,
      ...(topPosts.length ? { topPosts } : {}),
    },
  };
}

const YT_RECENT = 20;

async function readYouTube(handle: string): Promise<CreatorReadResult> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return { ok: false, reason: "no-credentials" };

  const clean = handle.replace(/^@/, "").trim();
  if (!clean) return { ok: false, reason: "unreadable", detail: "empty handle" };

  const api = async (path: string, params: Record<string, string>) => {
    const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
    for (const [k, v] of Object.entries({ ...params, key })) url.searchParams.set(k, v);
    const res = await fetch(url, { cache: "no-store" });
    if (res.status === 403 || res.status === 429) throw new Error(`quota:${res.status}`);
    if (!res.ok) throw new Error(`${path} ${res.status}`);
    return res.json();
  };

  try {
    // forHandle resolves @handles directly; forUsername only matches the old
    // legacy usernames, which almost no current channel has.
    const ch = await api("channels", {
      part: "statistics,contentDetails",
      forHandle: `@${clean}`,
    });
    const item = ch?.items?.[0];
    if (!item) return { ok: false, reason: "unreadable", detail: "no channel for handle" };

    const followersCount = Number(item.statistics?.subscriberCount ?? NaN);
    const postsCount = Number(item.statistics?.videoCount ?? 0);
    const uploads = item.contentDetails?.relatedPlaylists?.uploads;

    /* Lifetime viewCount/videoCount would be a different statistic to the one the
       other platforms report — it is dragged by a single old hit forever. Averaging
       the recent uploads instead costs two cheap calls and means the same thing. */
    let avgViews = 0;
    let sampledPosts = 0;
    let topPosts: TopPost[] = [];
    if (uploads) {
      const pl = await api("playlistItems", {
        part: "contentDetails",
        playlistId: uploads,
        maxResults: String(YT_RECENT),
      });
      const ids: string[] = (pl?.items ?? [])
        .map((i: any) => i?.contentDetails?.videoId)
        .filter(Boolean);
      if (ids.length) {
        // snippet rides along for the Top Posts card -- title, thumbnail,
        // publish date -- at no extra quota unit beyond the part itself.
        const vids = await api("videos", { part: "statistics,snippet", id: ids.join(",") });
        const items: any[] = vids?.items ?? [];
        const views = items
          .map((v: any) => Number(v?.statistics?.viewCount))
          .filter((n: number) => Number.isFinite(n));
        avgViews = mean(views);
        sampledPosts = views.length;
        topPosts = rankTopPosts(
          items.map((v: any) => ({
            postId: String(v?.id ?? ""),
            url: v?.id ? `https://www.youtube.com/watch?v=${v.id}` : null,
            caption: v?.snippet?.title ?? null,
            coverUrl:
              v?.snippet?.thumbnails?.medium?.url ?? v?.snippet?.thumbnails?.default?.url ?? null,
            views: Number.isFinite(Number(v?.statistics?.viewCount))
              ? Number(v.statistics.viewCount)
              : null,
            likes: Number.isFinite(Number(v?.statistics?.likeCount))
              ? Number(v.statistics.likeCount)
              : null,
            comments: Number.isFinite(Number(v?.statistics?.commentCount))
              ? Number(v.statistics.commentCount)
              : null,
            postedAt: v?.snippet?.publishedAt ?? null,
          }))
        );
      }
    }

    if (!Number.isFinite(followersCount)) {
      // A channel that hides its subscriber count is readable in every other way.
      return { ok: false, reason: "unreadable", detail: "subscriberCount hidden" };
    }
    return {
      ok: true,
      profile: {
        followersCount,
        postsCount,
        avgViews,
        sampledPosts,
        ...(topPosts.length ? { topPosts } : {}),
      },
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    if (detail.startsWith("quota:")) return { ok: false, reason: "rate-limited", detail };
    return { ok: false, reason: "unreadable", detail };
  }
}

/**
 * Read one creator's public figures.
 *
 * TikTok is routed to the browser reader by the caller rather than from here, so
 * that this module stays free of the serverless-Chromium import — it is used by
 * request paths that must not pay for that bundle.
 */
export async function readCreatorProfile(
  platform: string,
  handle: string
): Promise<CreatorReadResult> {
  switch (platform?.toUpperCase()) {
    case "INSTAGRAM":
      return readInstagram(handle);
    case "YOUTUBE":
      return readYouTube(handle);
    case "TIKTOK":
      /* Profile pages are server-rendered, unlike music pages, so this is a
         plain fetch and belongs here with the others rather than behind the
         browser seam the caller used to have to supply. */
      return fetchTikTokProfile(handle);
    default:
      return { ok: false, reason: "unsupported-platform" };
  }
}
