import { createLogger } from "@/lib/observability/logger";

/**
 * The authorised-creator half of the YouTube integration.
 *
 * Until now YouTube had no OAuth code path at all: `/api/portal/connections/
 * youtube/start` would complete a full OAuth dance and the callback would
 * encrypt and store the token, but nothing anywhere read it back. Public
 * figures came from the API key in `creatorProfile.ts` and
 * `fetchPostMetrics.ts`, so a creator who connected YouTube got a row in the
 * database and no data.
 *
 * Shapes mirror `tiktokDisplay.ts` and `instagramAccount.ts` so
 * `/api/portal/insights` can treat all three alike.
 */

const API_BASE = "https://www.googleapis.com/youtube/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/** Matches the per-refresh media cap the other two platforms use. It is also
 *  under videos.list's batch ceiling, which is exactly 50 — measured
 *  2026-09-06: 51 ids returns HTTP 400, not a truncated result. */
const MEDIA_LIMIT = 12;

export type YouTubeChannelInfo = {
  channelId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  profileLink: string | null;
  /**
   * Always false. The Data API exposes no verification or channel-badge field,
   * so there is nothing to read. Present so the portal can render every
   * platform through one type.
   */
  isVerified: boolean;
  /**
   * Rounded by YouTube to three significant figures for any channel above
   * 1,000 subscribers (measured 2026-09-06), and `null` here when the channel
   * hides the count — which is not the same as zero and must not be stored as
   * one.
   */
  followerCount: number | null;
  followingCount: number;
  mediaCount: number;
  totalViews: number;
  uploadsPlaylistId: string | null;
};

export type YouTubeVideoItem = {
  id: string;
  title: string;
  description: string;
  coverImageUrl: string | null;
  shareUrl: string | null;
  postedAt: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  /** Uncoerced counters — see the note on TikTokVideo.exact. `shares` is never
   *  set: the Data API has no share metric at all (it lives in the YouTube
   *  Analytics API, behind a scope this app does not request), so recording 0
   *  would invent a measurement. */
  exact: {
    views?: number;
    likes?: number;
    comments?: number;
    createdAt?: Date;
  };
};

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  /* The Data API returns every statistic as a decimal STRING, not a number
     ("viewCount": "10432"), so a plain typeof check would score every counter
     as zero. */
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function optNum(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function bestThumbnail(thumbnails: unknown): string | null {
  if (!thumbnails || typeof thumbnails !== "object") return null;
  const t = thumbnails as Record<string, { url?: unknown }>;
  for (const size of ["maxres", "standard", "high", "medium", "default"]) {
    const url = t[size]?.url;
    if (typeof url === "string") return url;
  }
  return null;
}

/**
 * A GET against the Data API on the creator's OAuth token.
 *
 * Returns null on every failure, and logs the reason so an expired token, a
 * missing scope and an exhausted quota stay distinguishable in the logs even
 * though callers see one value. Never logs the token.
 */
async function apiGet(
  path: string,
  params: Record<string, string>,
  token: string,
  signal?: AbortSignal,
): Promise<any | null> {
  const url = new URL(`${API_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const log = createLogger({ context: { platform: "YOUTUBE", call: `api.${path}` } });
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal,
    });
    if (!res.ok) {
      let reason: unknown;
      let message: unknown;
      try {
        const body = await res.json();
        reason = body?.error?.errors?.[0]?.reason;
        message = body?.error?.message;
      } catch {
        // non-JSON error body; the status alone has to do
      }
      log.error("Data API request failed", { status: res.status, reason, message });
      return null;
    }
    return await res.json();
  } catch (err) {
    log.error("Data API request threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Identity and account-level stats for the channel behind the token. */
export async function fetchYouTubeChannel(
  token: string,
  signal?: AbortSignal,
): Promise<YouTubeChannelInfo | null> {
  const data = await apiGet(
    "channels",
    { part: "snippet,statistics,contentDetails", mine: "true" },
    token,
    signal,
  );

  const channel = data?.items?.[0];
  if (!channel || typeof channel.id !== "string") return null;

  const snippet = channel.snippet ?? {};
  const stats = channel.statistics ?? {};
  const handle =
    typeof snippet.customUrl === "string" && snippet.customUrl
      ? snippet.customUrl.replace(/^@/, "")
      : "";
  const title = typeof snippet.title === "string" ? snippet.title : "";

  return {
    channelId: channel.id,
    /* customUrl is the closest thing YouTube has to a handle, but a channel
       that never claimed one has none — the title is then the only human name
       available, and an empty handle would render as a blank row. */
    username: handle || title,
    displayName: title,
    avatarUrl: bestThumbnail(snippet.thumbnails),
    bio:
      typeof snippet.description === "string" && snippet.description
        ? snippet.description
        : null,
    profileLink: handle
      ? `https://www.youtube.com/@${handle}`
      : `https://www.youtube.com/channel/${channel.id}`,
    isVerified: false,
    followerCount:
      stats.hiddenSubscriberCount === true ? null : num(stats.subscriberCount),
    followingCount: 0,
    mediaCount: num(stats.videoCount),
    totalViews: num(stats.viewCount),
    uploadsPlaylistId:
      typeof channel.contentDetails?.relatedPlaylists?.uploads === "string"
        ? channel.contentDetails.relatedPlaylists.uploads
        : null,
  };
}

/**
 * The creator's own recent uploads with their counters.
 *
 * Two calls, because the Data API has no "my recent videos with statistics"
 * edge: the uploads playlist yields ids, then one batched videos.list yields
 * the statistics. Returns null when either call fails, so the portal can tell
 * "needs reconnect" from "has uploaded nothing".
 */
export async function fetchYouTubeVideos(
  token: string,
  uploadsPlaylistId: string,
  signal?: AbortSignal,
): Promise<YouTubeVideoItem[] | null> {
  const playlist = await apiGet(
    "playlistItems",
    {
      part: "contentDetails",
      playlistId: uploadsPlaylistId,
      maxResults: String(MEDIA_LIMIT),
    },
    token,
    signal,
  );
  if (!playlist) return null;

  const ids: string[] = (playlist.items ?? [])
    .map((item: any) => item?.contentDetails?.videoId)
    .filter((id: unknown): id is string => typeof id === "string" && id.length > 0);

  if (ids.length === 0) return [];

  const videos = await apiGet(
    "videos",
    { part: "snippet,statistics,status", id: ids.join(",") },
    token,
    signal,
  );
  if (!videos) return null;

  /* The uploads playlist lists every upload the owner can see, unlisted and
     private included. The portal card is captioned "last N public posts", so
     anything a viewer could not find on the channel is left out here. */
  const publicItems = (videos.items ?? []).filter(
    (v: any) => v?.status?.privacyStatus === "public",
  );

  return publicItems.map((v: any) => {
    const snippet = v?.snippet ?? {};
    const stats = v?.statistics ?? {};
    const publishedAt =
      typeof snippet.publishedAt === "string" ? snippet.publishedAt : null;
    const createdAt = publishedAt ? new Date(publishedAt) : undefined;
    const views = optNum(stats.viewCount);
    const likes = optNum(stats.likeCount);
    const comments = optNum(stats.commentCount);

    return {
      id: typeof v?.id === "string" ? v.id : "",
      title: typeof snippet.title === "string" ? snippet.title : "",
      description:
        typeof snippet.description === "string" ? snippet.description : "",
      coverImageUrl: bestThumbnail(snippet.thumbnails),
      shareUrl: typeof v?.id === "string" ? `https://www.youtube.com/watch?v=${v.id}` : null,
      postedAt: publishedAt ?? new Date().toISOString(),
      viewsCount: num(views),
      likesCount: num(likes),
      commentsCount: num(comments),
      /* No share metric exists in the Data API — see the note on `exact`. */
      sharesCount: 0,
      exact: {
        views,
        likes,
        comments,
        ...(createdAt && !Number.isNaN(createdAt.getTime()) ? { createdAt } : {}),
      },
    };
  });
}

export type RefreshedYouTubeToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
};

/**
 * Trades the stored refresh token for a fresh access token.
 *
 * Google does not return a new refresh token on a refresh, so the caller must
 * keep the one it already has — returning null for it here means "unchanged",
 * not "revoked".
 */
export async function refreshYouTubeAccessToken(
  refreshToken: string,
): Promise<RefreshedYouTubeToken | null> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const log = createLogger({ context: { platform: "YOUTUBE", call: "token.refresh" } });
  if (!clientId || !clientSecret) {
    log.warn("Refresh attempted with no Google client credentials configured");
    return null;
  }

  try {
    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    if (!res.ok) {
      /* A 400 with invalid_grant here is the 7-day expiry that applies while
         the OAuth consent screen is unpublished (Testing mode). It reads like a
         corrupt token but means the app needs publishing. */
      let error: unknown;
      try {
        error = (await res.json())?.error;
      } catch {
        // non-JSON body
      }
      log.warn("Token refresh failed", { status: res.status, error });
      return null;
    }
    const body = await res.json();
    if (typeof body?.access_token !== "string") return null;
    return {
      accessToken: body.access_token,
      refreshToken:
        typeof body.refresh_token === "string" ? body.refresh_token : null,
      expiresAt:
        typeof body.expires_in === "number" && body.expires_in > 0
          ? new Date(Date.now() + body.expires_in * 1000)
          : null,
    };
  } catch (err) {
    log.warn("Token refresh threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Revokes the grant at Google, so Disconnect means disconnected there too. */
export async function revokeYouTubeToken(token: string): Promise<boolean> {
  const log = createLogger({ context: { platform: "YOUTUBE", call: "token.revoke" } });
  try {
    const res = await fetch(REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    if (!res.ok) {
      log.warn("Token revoke failed", { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    log.warn("Token revoke threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
