import { createLogger } from "@/lib/observability/logger";
import { InstagramAuthError, isAuthFailure } from "./instagram";

/**
 * Instagram API with Instagram Login — the Page-free half of Instagram.
 *
 * `instagramAccount.ts` is the other half and gets to the same account a
 * different way: the creator authorises **Facebook**, we list their Pages, and
 * the IG Business account hangs off one of them. That path is kept because
 * business_discovery (public numbers for creators who never authorised us)
 * exists only there.
 *
 * This path has no Page in it at all. The creator authorises Instagram, and
 * every read is `graph.instagram.com/me/...` with their own token. Three
 * consequences, and all three are why this is a separate module rather than a
 * host swap inside instagramAccount.ts:
 *
 *   1. **The host differs.** graph.facebook.com will not answer for an
 *      Instagram-Login token, and graph.instagram.com will not answer for a
 *      Facebook user token.
 *   2. **The long-lived exchange differs.** Facebook's is
 *      `grant_type=fb_exchange_token` on the oauth edge; Instagram's is
 *      `grant_type=ig_exchange_token` on graph.instagram.com, and it yields a
 *      60-day token that can be REFRESHED in place (ig_refresh_token) — which
 *      Facebook user tokens cannot be.
 *   3. **The revoke differs.** There is no `me/permissions` on this host. The
 *      creator withdraws access from Instagram's own settings, so disconnect
 *      here deletes the row and says so, rather than calling
 *      graph.facebook.com and silently failing — which is what would happen if
 *      these rows shared Facebook's revoke.
 */

const IG_GRAPH = "https://graph.instagram.com/v23.0";
/** The token endpoints live off the versioned path. */
const IG_GRAPH_ROOT = "https://graph.instagram.com";

const REQUEST_TIMEOUT_MS = 5000;

const PROFILE_FIELDS = [
  /* user_id, not id: on this API `id` is the app-scoped id and `user_id` is the
     Instagram account id — the one that matches what the Page path stores, so
     the same account connected either way lands on one row rather than two. */
  "user_id",
  "username",
  "name",
  "biography",
  "profile_picture_url",
  "followers_count",
  "follows_count",
  "media_count",
].join(",");

const MEDIA_FIELDS = [
  "id",
  "caption",
  "media_type",
  "media_product_type",
  "permalink",
  "media_url",
  "thumbnail_url",
  "timestamp",
  "like_count",
  "comments_count",
].join(",");

/** Matches instagramAccount.ts: each media's insights is its own call. */
const INSIGHTS_MEDIA_LIMIT = 12;

export type InstagramLoginProfile = {
  igUserId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  profileLink: string | null;
  /** Instagram publishes no verified flag on either path. */
  isVerified: boolean;
  followerCount: number;
  followingCount: number;
  mediaCount: number;
};

export type InstagramLoginMedia = {
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
  /** Uncoerced — a metric this media type does not support stays absent. */
  exact: {
    views?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    reach?: number;
    createdAt?: Date;
  };
};

export type LongLivedInstagramToken = {
  accessToken: string;
  expiresAt: Date | null;
};

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optNum(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * A GET against graph.instagram.com.
 *
 * Mirrors `graphGet` in instagram.ts, including throwing InstagramAuthError on
 * an auth failure rather than returning null: an expired token fails every
 * subsequent media read the same way, and collapsing that into "no data" is how
 * a dead connection renders as an account with no posts.
 */
async function igGet(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
  base: string = IG_GRAPH,
): Promise<any | null> {
  const url = new URL(`${base}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const log = createLogger({
    context: { platform: "INSTAGRAM", call: `iglogin.${path}` },
  });

  try {
    const res = await fetch(url.toString(), {
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      let code: unknown;
      let message: unknown;
      try {
        const body = await res.json();
        code = body?.error?.code;
        message = body?.error?.message;
      } catch {
        // non-JSON error body; the status alone has to do
      }
      /* Never the params: they carry access_token and client_secret. */
      log.error("Instagram Login request failed", {
        status: res.status,
        code,
        message,
      });
      if (isAuthFailure(res.status, code)) {
        throw new InstagramAuthError(
          res.status,
          typeof code === "number" ? code : undefined,
          typeof message === "string" ? message : `Instagram auth failure (${res.status})`,
        );
      }
      return null;
    }
    return await res.json();
  } catch (err) {
    if (err instanceof InstagramAuthError) throw err;
    log.warn("Instagram Login request threw", {
      error: err instanceof Error ? err.name : String(err),
    });
    return null;
  }
}

/**
 * Trades the code-exchange token for the 60-day one.
 *
 * The short-lived token from api.instagram.com lasts an hour. Unlike the
 * Facebook path this is not merely a nicety: there is no way to lengthen a
 * token after the fact, so a connection stored without this step dies within
 * the hour and the creator has to reconnect.
 */
export async function exchangeInstagramLoginToken(
  token: string,
  signal?: AbortSignal,
): Promise<LongLivedInstagramToken | null> {
  const clientSecret = process.env.INSTAGRAM_LOGIN_CLIENT_SECRET;
  if (!clientSecret) return null;

  const data = await igGet(
    "access_token",
    {
      grant_type: "ig_exchange_token",
      client_secret: clientSecret,
      access_token: token,
    },
    signal,
    IG_GRAPH_ROOT,
  );

  const accessToken = data?.access_token;
  if (typeof accessToken !== "string" || !accessToken) return null;

  const expiresIn = data?.expires_in;
  return {
    accessToken,
    expiresAt:
      typeof expiresIn === "number" && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000)
        : null,
  };
}

/**
 * Extends a long-lived token in place, for the refresh job.
 *
 * Instagram Login tokens can be refreshed while still valid and at least 24
 * hours old; a token that has already expired cannot be recovered and the
 * creator has to reconnect. Returns null rather than throwing so a refresh
 * failure never disturbs a connection that still works.
 */
export async function refreshInstagramLoginToken(
  token: string,
  signal?: AbortSignal,
): Promise<LongLivedInstagramToken | null> {
  const data = await igGet(
    "refresh_access_token",
    { grant_type: "ig_refresh_token", access_token: token },
    signal,
    IG_GRAPH_ROOT,
  ).catch(() => null);

  const accessToken = data?.access_token;
  if (typeof accessToken !== "string" || !accessToken) return null;

  const expiresIn = data?.expires_in;
  return {
    accessToken,
    expiresAt:
      typeof expiresIn === "number" && expiresIn > 0
        ? new Date(Date.now() + expiresIn * 1000)
        : null,
  };
}

/**
 * The authorised account. One call, no Page listing.
 *
 * This is what `instagram_business_basic` is for, and it is the whole reason
 * this path exists: `fetchInstagramAccount` returns null for a creator with no
 * Facebook Page, and that null is indistinguishable from a failed connection.
 */
export async function fetchInstagramLoginProfile(
  token: string,
  signal?: AbortSignal,
): Promise<InstagramLoginProfile | null> {
  const data = await igGet("me", { fields: PROFILE_FIELDS, access_token: token }, signal);
  if (!data) return null;

  /* user_id is the account id; `id` on this response is app-scoped and would
     not match the Page path's stored platformUserId for the same account. */
  const igUserId =
    typeof data.user_id === "string"
      ? data.user_id
      : typeof data.user_id === "number"
        ? String(data.user_id)
        : typeof data.id === "string"
          ? data.id
          : null;
  if (!igUserId) return null;

  const username = typeof data.username === "string" ? data.username : "";
  return {
    igUserId,
    username,
    displayName: typeof data.name === "string" && data.name ? data.name : username,
    avatarUrl:
      typeof data.profile_picture_url === "string" ? data.profile_picture_url : null,
    bio: typeof data.biography === "string" && data.biography ? data.biography : null,
    profileLink: username ? `https://www.instagram.com/${username}/` : null,
    isVerified: false,
    followerCount: num(data.followers_count),
    followingCount: num(data.follows_count),
    mediaCount: num(data.media_count),
  };
}

type MediaInsights = { views?: number; reach?: number; shares?: number };

/**
 * Per-media insights, with the same all-or-nothing retry the Page path needs.
 *
 * Instagram rejects the WHOLE request with a 400 when any single metric is
 * unsupported for that media type rather than omitting it, so asking for three
 * metrics at once returns nothing for a media that supports two. Ladder down
 * instead of giving up, and leave a metric that never answered absent — never
 * zero.
 */
async function fetchMediaInsights(
  mediaId: string,
  token: string,
  signal?: AbortSignal,
): Promise<MediaInsights> {
  const ask = (metric: string) =>
    igGet(`${mediaId}/insights`, { metric, access_token: token }, signal).catch(
      (err) => {
        /* An auth failure is the connection's problem, not this media's, and
           every remaining media would fail identically. */
        if (err instanceof InstagramAuthError) throw err;
        return null;
      },
    );

  let data = await ask("views,reach,shares");
  if (!data) data = await ask("views,reach");
  if (!data) data = await ask("views");

  const rows: Array<{ name?: string; values?: Array<{ value?: unknown }> }> =
    data?.data ?? [];
  const read = (name: string) =>
    optNum(rows.find((r) => r.name === name)?.values?.[0]?.value);

  return { views: read("views"), reach: read("reach"), shares: read("shares") };
}

/**
 * The creator's recent media with their counters.
 *
 * Returns null — not an empty array — when the media edge itself failed, so
 * "needs reconnect" stays distinguishable from "has posted nothing".
 */
export async function fetchInstagramLoginMedia(
  token: string,
  signal?: AbortSignal,
): Promise<InstagramLoginMedia[] | null> {
  const data = await igGet(
    "me/media",
    { fields: MEDIA_FIELDS, access_token: token, limit: String(INSIGHTS_MEDIA_LIMIT) },
    signal,
  );
  if (!data) return null;

  const media: Array<Record<string, unknown>> = Array.isArray(data.data) ? data.data : [];

  const insights: MediaInsights[] = await Promise.all(
    media.map((m): Promise<MediaInsights> =>
      typeof m.id === "string"
        ? fetchMediaInsights(m.id, token, signal)
        : Promise.resolve({}),
    ),
  );

  return media.map((m, i) => {
    const caption = typeof m.caption === "string" ? m.caption : "";
    const timestamp = typeof m.timestamp === "string" ? m.timestamp : null;
    const createdAt = timestamp ? new Date(timestamp) : undefined;
    const { views, reach, shares } = insights[i] ?? {};
    const likes = optNum(m.like_count);
    const comments = optNum(m.comments_count);

    return {
      id: typeof m.id === "string" ? m.id : "",
      /* Instagram has no title; the caption's first line is the only text. */
      title: caption.split("\n")[0] ?? "",
      description: caption,
      coverImageUrl:
        typeof m.thumbnail_url === "string"
          ? m.thumbnail_url
          : typeof m.media_url === "string"
            ? m.media_url
            : null,
      shareUrl: typeof m.permalink === "string" ? m.permalink : null,
      postedAt: timestamp ?? new Date().toISOString(),
      viewsCount: num(views),
      likesCount: num(likes),
      commentsCount: num(comments),
      sharesCount: num(shares),
      exact: {
        views,
        likes,
        comments,
        shares,
        reach,
        ...(createdAt && !Number.isNaN(createdAt.getTime()) ? { createdAt } : {}),
      },
    };
  });
}

/**
 * There is no revoke endpoint on this path, and saying so is the point.
 *
 * graph.instagram.com publishes no `me/permissions` DELETE. Calling Facebook's
 * would be worse than doing nothing: it would 400 against a token that host
 * does not govern, and the disconnect route swallows revoke failures — so the
 * creator would be told their account was disconnected everywhere while the
 * grant stayed live at Instagram.
 *
 * Returns false, which is the honest answer to "did we withdraw the grant".
 * Threads is the same shape and handled the same way. The row is still deleted
 * by the caller; the creator removes the app from Instagram → Settings →
 * Website permissions → Apps and websites.
 */
export function revokeInstagramLoginToken(): false {
  return false;
}
