import { graphGet, resolveIgUserId, shortcodeFromUrl } from "./instagram";

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

export function businessDiscoveryToken(): string | undefined {
  return process.env.INSTAGRAM_BUSINESS_TOKEN || undefined;
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

export async function fetchInstagramProfile(
  username: string,
  token: string,
  signal?: AbortSignal,
  after?: string,
): Promise<IgPublicProfile | null> {
  const handle = normalizeUsername(username);
  if (!handle) return null;

  const igUserId = await resolveIgUserId(token, signal);
  if (!igUserId) return null;

  /* `.after(cursor)` before `.limit()` -- Graph reads the edge modifiers left to
     right and silently ignores an unknown ordering rather than erroring, which
     is exactly the kind of failure that looks like "there are no more pages". */
  const pageArgs = after ? `.after(${after}).limit(${MEDIA_PAGE_SIZE})` : `.limit(${MEDIA_PAGE_SIZE})`;
  const mediaFields = `media${pageArgs}{id,caption,view_count,like_count,comments_count,timestamp,permalink,media_url,thumbnail_url}`;
  const data = await graphGet(
    igUserId,
    {
      fields: `business_discovery.username(${handle}){followers_count,media_count,${mediaFields}}`,
      access_token: token,
    },
    signal,
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
): Promise<(IgPublicPost & { authorFollowers?: number }) | null> {
  const shortcode = shortcodeFromUrl(postUrl);
  if (!shortcode) return null;

  let cursor: string | undefined;
  let followers: number | undefined;

  for (let page = 0; page < MAX_MEDIA_PAGES; page++) {
    const profile = await fetchInstagramProfile(username, token, signal, cursor);
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
