import { createLogger } from "../observability/logger";

const API_BASE = "https://open.tiktokapis.com/v2";

const USER_FIELDS = [
  "open_id",
  "username",
  "display_name",
  "avatar_url",
  "bio_description",
  "profile_deep_link",
  "is_verified",
  "follower_count",
  "following_count",
  "likes_count",
  "video_count",
].join(",");

const VIDEO_FIELDS = [
  "id",
  "title",
  "video_description",
  "duration",
  "cover_image_url",
  "share_url",
  "embed_link",
  "create_time",
  "view_count",
  "like_count",
  "comment_count",
  "share_count",
].join(",");

export type TikTokUserInfo = {
  openId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  profileLink: string | null;
  isVerified: boolean;
  followerCount: number;
  followingCount: number;
  likesCount: number;
  videoCount: number;
};

export type TikTokVideo = {
  id: string;
  title: string;
  description: string;
  durationSeconds: number;
  coverImageUrl: string | null;
  shareUrl: string | null;
  embedLink: string | null;
  postedAt: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  /**
   * The same four counters and the timestamp, UNCOERCED -- absent stays absent.
   *
   * The fields above run every value through num(), which turns a missing
   * counter into 0. That is the right shape for the three display consumers
   * (the creator page, portal insights, the top-posts ranker) which want a
   * number to render or average and treat 0 as "nothing to show".
   *
   * It is the wrong shape for lib/platforms/fetchPostMetrics, which WRITES what
   * it is given: a coerced 0 arrives at applyPostMetrics indistinguishable from
   * a real zero, gets lastSyncedAt stamped beside it, and becomes a measured
   * fact that no later sync can correct. Every other stats mapper in this
   * codebase already returns optional counters for exactly this reason -- see
   * TikTokDirectMetrics in fetchPostMetrics, whose doc comment says every field
   * in TikTok's stats block is optional. This path was the one that had not
   * learned it.
   *
   * `createdAt` is here for the same reason: postedAt above falls back to
   * Date.now() when create_time is missing, which stamps today's date onto a
   * post published months ago.
   */
  exact: {
    views?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    createdAt?: Date;
  };
};

function timeoutSignal(ms = 8000): AbortSignal | undefined {
  return typeof AbortSignal !== "undefined" &&
    typeof AbortSignal.timeout === "function"
    ? AbortSignal.timeout(ms)
    : undefined;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** num()'s honest sibling: absent stays absent. See TikTokVideo.exact. */
function optionalNum(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function mapVideo(v: Record<string, unknown>): TikTokVideo[] {
  const id = str(v.id);
  if (!id) return [];
  const createdSeconds = num(v.create_time);
  return [
    {
      id,
      title: str(v.title) ?? "",
      description: str(v.video_description) ?? "",
      durationSeconds: num(v.duration),
      coverImageUrl: str(v.cover_image_url),
      shareUrl: str(v.share_url),
      embedLink: str(v.embed_link),
      postedAt: new Date(
        createdSeconds > 0 ? createdSeconds * 1000 : Date.now(),
      ).toISOString(),
      viewsCount: num(v.view_count),
      likesCount: num(v.like_count),
      commentsCount: num(v.comment_count),
      sharesCount: num(v.share_count),
      exact: {
        ...(optionalNum(v.view_count) !== undefined
          ? { views: optionalNum(v.view_count) }
          : {}),
        ...(optionalNum(v.like_count) !== undefined
          ? { likes: optionalNum(v.like_count) }
          : {}),
        ...(optionalNum(v.comment_count) !== undefined
          ? { comments: optionalNum(v.comment_count) }
          : {}),
        ...(optionalNum(v.share_count) !== undefined
          ? { shares: optionalNum(v.share_count) }
          : {}),
        ...(createdSeconds > 0 ? { createdAt: new Date(createdSeconds * 1000) } : {}),
      },
    },
  ];
}

export type RefreshedTikTokToken = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
};

// TikTok may or may not return a new refresh token; observed unchanged in sandbox.
// Callers must persist one when it is returned and keep the old one when it is not.
export async function refreshTikTokAccessToken(
  refreshToken: string,
): Promise<RefreshedTikTokToken | null> {
  const log = createLogger({ context: { platform: "TIKTOK", call: "oauth.refresh" } });
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    log.error("TikTok client credentials not configured; cannot refresh");
    return null;
  }

  try {
    const res = await fetch(`${API_BASE}/oauth/token/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
      cache: "no-store",
      signal: timeoutSignal(),
    });
    if (!res.ok) {
      log.error("TikTok token refresh failed", { status: res.status });
      return null;
    }

    const json = (await res.json()) as {
      access_token?: unknown;
      refresh_token?: unknown;
      expires_in?: unknown;
      error?: unknown;
    };
    const accessToken = str(json.access_token);
    if (!accessToken) {
      log.error("TikTok token refresh returned no access token", {
        error: typeof json.error === "string" ? json.error : undefined,
      });
      return null;
    }

    const expiresIn = num(json.expires_in);
    return {
      accessToken,
      refreshToken: str(json.refresh_token),
      expiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null,
    };
  } catch (err) {
    log.error("TikTok token refresh threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function revokeTikTokToken(accessToken: string): Promise<boolean> {
  const log = createLogger({ context: { platform: "TIKTOK", call: "oauth.revoke" } });
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) return false;
  try {
    const res = await fetch(`${API_BASE}/oauth/revoke/`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: clientKey,
        client_secret: clientSecret,
        token: accessToken,
      }),
      signal: timeoutSignal(),
    });
    if (!res.ok) {
      log.error("TikTok token revoke failed", { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    log.error("TikTok token revoke threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

export async function fetchTikTokUserInfo(
  accessToken: string,
): Promise<TikTokUserInfo | null> {
  const log = createLogger({ context: { platform: "TIKTOK", call: "user.info" } });
  try {
    const res = await fetch(`${API_BASE}/user/info/?fields=${USER_FIELDS}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: timeoutSignal(),
    });
    if (!res.ok) {
      log.error("TikTok user.info request failed", { status: res.status });
      return null;
    }
    const json = (await res.json()) as {
      data?: { user?: Record<string, unknown> };
      error?: { code?: string };
    };
    const user = json?.data?.user;
    if (!user || typeof user.open_id !== "string") {
      log.warn("TikTok user.info returned no user", { code: json?.error?.code });
      return null;
    }
    return {
      openId: user.open_id,
      username: str(user.username) ?? "",
      displayName: str(user.display_name) ?? "",
      avatarUrl: str(user.avatar_url),
      bio: str(user.bio_description),
      profileLink: str(user.profile_deep_link),
      isVerified: user.is_verified === true,
      followerCount: num(user.follower_count),
      followingCount: num(user.following_count),
      likesCount: num(user.likes_count),
      videoCount: num(user.video_count),
    };
  } catch (err) {
    log.error("TikTok user.info fetch threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

// Returns only the videos that belong to the token's own account; TikTok silently
// omits any id it does not own, so a foreign post id yields an empty result.
export async function fetchTikTokVideosByIds(
  accessToken: string,
  videoIds: string[],
): Promise<TikTokVideo[]> {
  const log = createLogger({ context: { platform: "TIKTOK", call: "video.query" } });
  const ids = [...new Set(videoIds.filter((id) => /^\d+$/.test(id)))];
  if (ids.length === 0) return [];

  const out: TikTokVideo[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const chunk = ids.slice(i, i + 20);
    try {
      const res = await fetch(`${API_BASE}/video/query/?fields=${VIDEO_FIELDS}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filters: { video_ids: chunk } }),
        cache: "no-store",
        signal: timeoutSignal(),
      });
      if (!res.ok) {
        log.error("TikTok video.query request failed", {
          status: res.status,
          count: chunk.length,
        });
        continue;
      }
      const json = (await res.json()) as {
        data?: { videos?: Record<string, unknown>[] };
        error?: { code?: string };
      };
      const videos = json?.data?.videos;
      if (!Array.isArray(videos)) {
        log.warn("TikTok video.query returned no videos", { code: json?.error?.code });
        continue;
      }
      out.push(...videos.flatMap(mapVideo));
    } catch (err) {
      log.error("TikTok video.query fetch threw", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return out;
}

// Null means the call itself failed (token rejected, network, malformed body).
// An empty array means TikTok answered and the account genuinely has no posts —
// callers must not conflate the two, or a dead connection reads as "post something".
export async function fetchTikTokVideos(
  accessToken: string,
  maxCount = 20,
): Promise<TikTokVideo[] | null> {
  const log = createLogger({ context: { platform: "TIKTOK", call: "video.list" } });
  try {
    const res = await fetch(`${API_BASE}/video/list/?fields=${VIDEO_FIELDS}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ max_count: Math.min(Math.max(maxCount, 1), 20) }),
      cache: "no-store",
      signal: timeoutSignal(),
    });
    if (!res.ok) {
      log.error("TikTok video.list request failed", { status: res.status });
      return null;
    }
    const json = (await res.json()) as {
      data?: { videos?: Record<string, unknown>[] };
      error?: { code?: string };
    };
    const videos = json?.data?.videos;
    if (!Array.isArray(videos)) {
      log.warn("TikTok video.list returned no videos", { code: json?.error?.code });
      return null;
    }
    return videos.flatMap(mapVideo);
  } catch (err) {
    log.error("TikTok video.list fetch threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
