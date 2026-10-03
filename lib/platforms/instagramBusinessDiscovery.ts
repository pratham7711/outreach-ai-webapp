import { getInstagramBusinessToken } from "@/lib/platforms/instagramBusinessToken";
import { graphGet, resolveIgUserId, shortcodeFromUrl, type GraphHeadersListener } from "./instagram";

export type IgPublicPost = {
  id: string;
  permalink: string | null;
  caption: string | null;
  /* Optional because Instagram omits these rather than sending zero: view_count
     is absent on a still image, and like_count is absent whenever the creator has
     hidden their like counts. Reading an absent field as 0 told a client report
     that a ten-thousand-view reel earned no likes. */
  viewsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  postedAt: Date | null;
  thumbnailUrl: string | null;
};

export type IgPublicProfile = {
  username: string;
  /* Absent, not zero, when Business Discovery did not report it -- the same
     reason the per-post counters above are optional. A creator with no follower
     figure is not a creator with no followers. */
  followersCount?: number;
  mediaCount?: number;
  /** Signed Meta CDN URL; it expires, so it is downloaded rather than kept. */
  profilePictureUrl?: string;
  /** The account's Instagram user id: stable across renames, unlike the
   *  username (plan A4). Asked for in the same request, so it costs nothing. */
  igUserId?: string;
  recentPosts: IgPublicPost[];
  /**
   * Instagram's cursor for the NEXT page of this profile's media, when one
   * exists. Business Discovery caps a single read at 100 media, and for a
   * prolific creator the post a campaign is tracking is routinely older than
   * that -- so without following this, those posts are not merely unmeasured,
   * they are unreachable, permanently, no matter how often a refresh retries.
   */
  nextMediaCursor?: string;
};

type DiscoveryMediaNode = {
  id?: string;
  permalink?: string;
  caption?: string;
  view_count?: number;
  like_count?: number;
  comments_count?: number;
  timestamp?: string;
  thumbnail_url?: string;
  media_url?: string;
};

/**
 * Async now, because the credential moved somewhere that can be rewritten.
 *
 * It used to be one env lookup, which is why it was synchronous. The value now
 * comes from the credential store (lib/platforms/instagramBusinessToken.ts)
 * with the env var behind it, cached in-process so a sync reading two hundred
 * posts still costs about one query a minute.
 */
export async function businessDiscoveryToken(): Promise<string | undefined> {
  return getInstagramBusinessToken();
}

function normalizeUsername(input: string): string {
  return input.replace(/^@/, "").trim();
}

function mapMedia(node: DiscoveryMediaNode): IgPublicPost {
  return {
    id: node.id ?? "",
    permalink: node.permalink ?? null,
    caption: node.caption ?? null,
    ...(typeof node.view_count === "number" ? { viewsCount: node.view_count } : {}),
    ...(typeof node.like_count === "number" ? { likesCount: node.like_count } : {}),
    ...(typeof node.comments_count === "number" ? { commentsCount: node.comments_count } : {}),
    postedAt: node.timestamp ? new Date(node.timestamp) : null,
    thumbnailUrl: node.thumbnail_url ?? node.media_url ?? null,
  };
}

export function parseBusinessDiscovery(data: any, username: string): IgPublicProfile | null {
  const bd = data?.business_discovery;
  if (!bd) return null;
  const nodes: DiscoveryMediaNode[] = bd.media?.data ?? [];
  const after = bd.media?.paging?.cursors?.after;
  return {
    username: normalizeUsername(username),
    ...(typeof bd.followers_count === "number" ? { followersCount: bd.followers_count } : {}),
    ...(typeof bd.media_count === "number" ? { mediaCount: bd.media_count } : {}),
    ...(typeof bd.profile_picture_url === "string" && bd.profile_picture_url
      ? { profilePictureUrl: bd.profile_picture_url }
      : {}),
    ...(typeof bd.id === "string" && /^\d+$/.test(bd.id) ? { igUserId: bd.id } : {}),
    recentPosts: nodes.map(mapMedia),
    ...(typeof after === "string" && after.length > 0 ? { nextMediaCursor: after } : {}),
  };
}

export const MEDIA_PAGE_SIZE = 100;

/**
 * How many pages a post lookup will walk before giving up.
 *
 * 5 x 100 covers a creator's newest 500 media, which is past the tail of every
 * campaign we track, while bounding the worst case at five Graph round trips
 * inside a refresh that has a 260s budget for the whole campaign. Each page is
 * one request, and the walk stops the moment the post is found -- so the common
 * case still costs exactly one.
 */
export const MAX_MEDIA_PAGES = 5;

export type DiscoveryReadOptions = {
  rateLimitThrows?: boolean;
  noSuchAccountThrows?: boolean;
  /** The IG user id the token belongs to, when it is configured rather than
   *  looked up. Saves the me/accounts round trip on every page; absent, it is
   *  resolved from the token as it always has been. */
  igUserId?: string;
  /** Reads Meta's usage headers on every call this read makes. */
  onHeaders?: GraphHeadersListener;
  /** How many media to ask for. Defaults to a full page; a profile read that
   *  only needs the newest posts asks for fewer, which is what Meta's
   *  total_time usage is spent on. */
  mediaLimit?: number;
};

export async function fetchInstagramProfile(
  username: string,
  token: string,
  signal?: AbortSignal,
  after?: string,
  {
    rateLimitThrows = false,
    noSuchAccountThrows = false,
    igUserId: knownIgUserId,
    onHeaders,
    mediaLimit = MEDIA_PAGE_SIZE,
  }: DiscoveryReadOptions = {},
): Promise<IgPublicProfile | null> {
  const handle = normalizeUsername(username);
  if (!handle) return null;

  const igUserId = knownIgUserId || (await resolveIgUserId(token, signal, { rateLimitThrows, onHeaders }));
  if (!igUserId) return null;

  /* `.after(cursor)` before `.limit()` -- Graph reads the edge modifiers left to
     right and silently ignores an unknown ordering rather than erroring, which
     is exactly the kind of failure that looks like "there are no more pages". */
  const limit = Math.max(1, Math.min(MEDIA_PAGE_SIZE, Math.round(mediaLimit)));
  const pageArgs = after ? `.after(${after}).limit(${limit})` : `.limit(${limit})`;
  const mediaFields = `media${pageArgs}{id,caption,view_count,like_count,comments_count,timestamp,permalink,media_url,thumbnail_url}`;
  const data = await graphGet(
    igUserId,
    {
      fields: `business_discovery.username(${handle}){id,followers_count,media_count,profile_picture_url,${mediaFields}}`,
      access_token: token,
    },
    signal,
    { rateLimitThrows, noSuchAccountThrows, onHeaders },
  );
  return parseBusinessDiscovery(data, handle);
}

/**
 * The post, plus the author's follower count -- which this had already fetched
 * and then dropped. Business Discovery answers with the profile and its recent
 * media in one response, so the follower figure costs nothing extra, and the
 * campaign roster had no source for it at all.
 */
export async function fetchInstagramPublicPostMetrics(
  username: string,
  postUrl: string,
  token: string,
  signal?: AbortSignal,
  options: Omit<DiscoveryReadOptions, "noSuchAccountThrows"> = {},
): Promise<(IgPublicPost & { authorFollowers?: number }) | null> {
  const shortcode = shortcodeFromUrl(postUrl);
  if (!shortcode) return null;

  let cursor: string | undefined;
  let followers: number | undefined;

  for (let page = 0; page < MAX_MEDIA_PAGES; page++) {
    /* Throws on the first page only: once a page has answered, the account
       exists, and a later 110 would be about something else. */
    const profile = await fetchInstagramProfile(username, token, signal, cursor, {
      ...options,
      noSuchAccountThrows: page === 0,
    });
    if (!profile) return null;
    /* Carried across pages because Instagram repeats followers_count on every
       page and the caller wants it even when the post turns up on page four. */
    if (typeof profile.followersCount === "number") followers = profile.followersCount;

    const post = profile.recentPosts.find(
      (p) => typeof p.permalink === "string" && p.permalink.includes(`/${shortcode}`),
    );
    if (post) {
      return {
        ...post,
        ...(typeof followers === "number" ? { authorFollowers: followers } : {}),
      };
    }

    /* No cursor means we have seen the creator's whole library, so the post is
       genuinely not on this account -- a different answer from "we ran out of
       pages", and only the latter is worth a fallback's time. */
    if (!profile.nextMediaCursor) return null;
    cursor = profile.nextMediaCursor;
  }
  return null;
}
