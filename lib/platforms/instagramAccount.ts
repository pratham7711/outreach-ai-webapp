import { graphGet, InstagramAuthError } from "./instagram";
import { createLogger } from "@/lib/observability/logger";

/**
 * The authorised-creator half of the Instagram integration.
 *
 * `instagramBusinessDiscovery.ts` is the other half and answers a different
 * question: public numbers for a creator who has NOT authorised us, read
 * through our own business token. Everything here runs on the creator's own
 * OAuth token and is what `instagram_basic` and `instagram_manage_insights`
 * exist for.
 *
 * Shapes deliberately mirror `tiktokDisplay.ts` so `/api/portal/insights` can
 * treat the platforms alike: identity + account stats from one call, a media
 * list with four counters from another, and an `exact` block that leaves a
 * missing counter missing.
 */

const ACCOUNT_FIELDS = [
  "id",
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

/** How many recent media to enrich with insights. Each one is its own Graph
 *  call, so this is the cap on the fan-out per refresh, not a display limit. */
const INSIGHTS_MEDIA_LIMIT = 12;

export type InstagramAccountInfo = {
  igUserId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  profileLink: string | null;
  /**
   * Always false, and that is a limit of the API rather than a claim about the
   * account. Instagram's Graph API exposes no `is_verified` field for an IG
   * User — not on the authorised account and not through business_discovery —
   * so there is nothing to read. Left in the shape so the portal can render
   * every platform through one type.
   */
  isVerified: boolean;
  followerCount: number;
  followingCount: number;
  mediaCount: number;
};

export type InstagramMediaItem = {
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
  /** Uncoerced counters — see the long note on TikTokVideo.exact. A metric
   *  Instagram does not support for a media type must not be written as 0. */
  exact: {
    views?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    createdAt?: Date;
  };
};

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function optNum(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * Resolves the IG Business account behind the creator's token.
 *
 * `resolveIgUserId` in instagram.ts answers the same question but returns only
 * the id, and getting the identity fields too would mean a second round trip
 * for data the same edge already carries.
 */
export async function fetchInstagramAccount(
  token: string,
  signal?: AbortSignal,
): Promise<InstagramAccountInfo | null> {
  const log = createLogger({
    context: { platform: "INSTAGRAM", call: "account.fetch" },
  });

  const pagesData = await graphGet(
    "me/accounts",
    {
      fields: `instagram_business_account{${ACCOUNT_FIELDS}}`,
      access_token: token,
      limit: "50",
    },
    signal,
  );

  const pages: Array<{ instagram_business_account?: Record<string, unknown> }> =
    pagesData?.data ?? [];

  for (const page of pages) {
    const ig = page.instagram_business_account;
    if (!ig || typeof ig.id !== "string") continue;

    const username = typeof ig.username === "string" ? ig.username : "";
    return {
      igUserId: ig.id,
      username,
      displayName: typeof ig.name === "string" && ig.name ? ig.name : username,
      avatarUrl:
        typeof ig.profile_picture_url === "string" ? ig.profile_picture_url : null,
      bio: typeof ig.biography === "string" && ig.biography ? ig.biography : null,
      profileLink: username ? `https://www.instagram.com/${username}/` : null,
      isVerified: false,
      followerCount: num(ig.followers_count),
      followingCount: num(ig.follows_count),
      mediaCount: num(ig.media_count),
    };
  }

  /* No page on the token carries an IG Business account. That is the ordinary
     shape of a creator who authorised with a personal Instagram account, not an
     error, so it logs at info and returns null for the caller to explain. */
  log.info("Token carries no Instagram Business account", {
    pagesSeen: pages.length,
  });
  return null;
}

type MediaInsights = { views?: number; shares?: number };

/**
 * Views and shares for one media, from the insights edge.
 *
 * This is the call `instagram_manage_insights` is for. Instagram supports a
 * different metric set per media type — `shares` is reels-only, and `views`
 * is unsupported on some older image media — so a metric that comes back
 * missing is left missing rather than recorded as zero.
 */
async function fetchMediaInsights(
  mediaId: string,
  token: string,
  signal?: AbortSignal,
): Promise<MediaInsights> {
  const ask = (metric: string) =>
    graphGet(`${mediaId}/insights`, { metric, access_token: token }, signal).catch(
      (err) => {
        /* An auth failure must reach the caller: it means the token or the
           scope is gone, and every remaining media would fail the same way.
           Anything else (an unsupported metric for this media type) is
           per-media and survivable. */
        if (err instanceof InstagramAuthError) throw err;
        return null;
      },
    );

  /* Instagram rejects the WHOLE request (400, code 100 "Invalid parameter")
     when any one metric is unsupported for that media, rather than omitting
     the metric — so a media that has views but no shares answered nothing at
     all. Ask for views alone before giving up on the media. Media published
     before the account became a Business/Creator account fail both calls; they
     stay unmeasured. */
  let data = await ask("views,shares");
  if (!data) data = await ask("views");

  const rows: Array<{ name?: string; values?: Array<{ value?: unknown }> }> =
    data?.data ?? [];
  const read = (name: string) =>
    optNum(rows.find((r) => r.name === name)?.values?.[0]?.value);

  return { views: read("views"), shares: read("shares") };
}

/**
 * The creator's own recent media with their four counters.
 *
 * Returns null — rather than an empty array — when the media edge itself
 * fails, so the portal can tell "needs reconnect" from "posted nothing".
 */
export async function fetchInstagramMedia(
  token: string,
  igUserId: string,
  signal?: AbortSignal,
): Promise<InstagramMediaItem[] | null> {
  const data = await graphGet(
    `${igUserId}/media`,
    { fields: MEDIA_FIELDS, access_token: token, limit: String(INSIGHTS_MEDIA_LIMIT) },
    signal,
  );
  if (!data) return null;

  const media: Array<Record<string, unknown>> = data?.data ?? [];

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
    const { views, shares } = insights[i] ?? {};
    const likes = optNum(m.like_count);
    const comments = optNum(m.comments_count);

    return {
      id: typeof m.id === "string" ? m.id : "",
      /* Instagram has no title field; the caption is the only text there is.
         Kept as the first line so a caption-as-title render stays readable. */
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
        ...(createdAt && !Number.isNaN(createdAt.getTime()) ? { createdAt } : {}),
      },
    };
  });
}

/**
 * Revokes our permissions on the creator's account, so Disconnect means
 * disconnected at Instagram too and not merely a forgotten row.
 *
 * TikTok's equivalent is `revokeTikTokToken`. Meta's is a DELETE on the
 * permissions edge, which drops every permission the token holds.
 */
export async function revokeInstagramToken(token: string): Promise<boolean> {
  const log = createLogger({
    context: { platform: "INSTAGRAM", call: "account.revoke" },
  });
  try {
    const res = await fetch(
      `https://graph.facebook.com/v26.0/me/permissions?access_token=${encodeURIComponent(token)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      log.warn("Permission revoke failed", { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    log.warn("Permission revoke threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
