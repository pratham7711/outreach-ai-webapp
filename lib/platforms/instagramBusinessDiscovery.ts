import { getInstagramBusinessToken } from "@/lib/platforms/instagramBusinessToken";
import {
  InstagramNoSuchAccountError,
  graphGet,
  resolveIgUserId,
  shortcodeFromUrl,
  type GraphHeadersListener,
} from "./instagram";

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
 * What Business Discovery answered a post read a moment ago, kept for a few
 * minutes.
 *
 * Meta throttles this app on time spent as well as on calls: on 2026-10-02/03
 * x-app-usage read total_time 199-253% against call_count 31-80%, and every
 * Business Discovery read in three refresh windows came back #4 -- which is
 * why those reads measured no views. A media page of 100 is the expensive
 * call, and every post read asked for it again, after a me/accounts round
 * trip: 121 posts by seven creators, added or refreshed together, fetched
 * each creator's newest page about seventeen times (121 / 7). One answer per
 * creator per few minutes carries the same numbers.
 *
 * Post reads only; fetchInstagramProfile itself is unchanged. Only answers are
 * kept -- a throw (rate limit, timeout, rejected token) or a null is asked
 * again exactly as before. Off under Jest, where each test fakes Graph afresh;
 * see setPostPageCache.
 */
export const POST_PAGE_TTL_MS = 5 * 60_000;
export const READER_ID_TTL_MS = 60 * 60_000;
const MAX_REMEMBERED = 200;

type Remembered<T> = { at: number; value: Promise<T> };
const postPages = new Map<string, Remembered<IgPublicProfile | null>>();
const readerIds = new Map<string, Remembered<string | null>>();
let rememberOn = process.env.NODE_ENV !== "test";

/** For tests: turns the post-read cache on or off, and empties it either way. */
export function setPostPageCache(on: boolean) {
  rememberOn = on;
  postPages.clear();
  readerIds.clear();
}

function remember<T>(
  cache: Map<string, Remembered<T>>,
  key: string,
  ttlMs: number,
  fresh: boolean,
  load: () => Promise<T>,
): Promise<T> {
  if (!rememberOn) return load();
  const nowMs = Date.now();
  const hit = cache.get(key);
  if (!fresh && hit && nowMs - hit.at < ttlMs) return hit.value;
  const value = load();
  cache.set(key, { at: nowMs, value });
  /* Readers that arrive while it is in flight share the one request. */
  const forget = () => {
    if (cache.get(key)?.value === value) cache.delete(key);
  };
  value.then((v) => {
    if (v === null) forget();
  }, forget);
  for (const [k, entry] of cache) {
    if (cache.size <= MAX_REMEMBERED) break;
    if (entry.value !== value) cache.delete(k);
  }
  return value;
}

const pageKey = (token: string, username: string, after: string | undefined, rateLimitThrows: boolean, page0: boolean) =>
  [token, normalizeUsername(username).toLowerCase(), after ?? "", String(rateLimitThrows), String(page0)].join("\n");

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
  {
    onNotOnAccount,
    onPastLookupDepth,
    ...options
  }: Omit<DiscoveryReadOptions, "noSuchAccountThrows"> & {
    /** Told when the walk reached the end of the creator's library and no page
     *  held the post -- an answer about the post, where a null alone also
     *  covers a failed page. */
    onNotOnAccount?: () => void;
    /** Told when every page asked for answered, none held the post, and
     *  Instagram still offered more: the post may simply be older than the
     *  newest MAX_MEDIA_PAGES x MEDIA_PAGE_SIZE media. */
    onPastLookupDepth?: () => void;
  } = {},
): Promise<(IgPublicPost & { authorFollowers?: number }) | null> {
  const shortcode = shortcodeFromUrl(postUrl);
  if (!shortcode) return null;

  const rateLimitThrows = options.rateLimitThrows ?? false;
  const igUserId =
    options.igUserId ||
    (await remember(readerIds, `${token}\n${rateLimitThrows}`, READER_ID_TTL_MS, false, () =>
      resolveIgUserId(token, signal, { rateLimitThrows, onHeaders: options.onHeaders }),
    ));
  if (!igUserId) return null;
  const read = { ...options, igUserId };

  const walkStartedAt = Date.now();
  const found = await walkForPost(username, shortcode, token, signal, read, MAX_MEDIA_PAGES, false);
  if (found !== "not-found" && found !== "out-of-pages") return found;
  /* On no page we were given -- but the newest page may be one remembered
     from minutes ago, and a post published since is on none of them. That
     page alone is asked again before the answer stands. */
  const newest = postPages.get(pageKey(token, username, undefined, rateLimitThrows, true));
  if (rememberOn && newest && newest.at < walkStartedAt) {
    const again = await walkForPost(username, shortcode, token, signal, read, 1, true);
    if (again !== "not-found" && again !== "out-of-pages") return again;
  }
  if (found === "out-of-pages") onPastLookupDepth?.();
  else onNotOnAccount?.();
  return null;
}

/**
 * Which of these accounts published the post, judged from each one's newest
 * page of media.
 *
 * A post read run backwards, for a post filed with no creator. Instagram's
 * embed does not always name a post's owner, but the owner's own media list
 * still carries the post. Only the newest page of each account is asked -- a
 * post pasted into a campaign is a recent one -- and it is the same remembered
 * page the campaign's other post reads fetch, so inside a sweep the lookup
 * usually costs no call at all.
 *
 * An account Business Discovery cannot see (personal, renamed, gone) is passed
 * over. A rate limit ends the lookup, because every later account would be
 * refused the same way, and the caller's token chooser needs to hear it.
 */
export async function findInstagramPostOwner(
  handles: readonly string[],
  postUrl: string,
  token: string,
  signal?: AbortSignal,
  options: Omit<DiscoveryReadOptions, "noSuchAccountThrows"> = {},
): Promise<{ handle: string; post: IgPublicPost & { authorFollowers?: number } } | null> {
  const shortcode = shortcodeFromUrl(postUrl);
  if (!shortcode || handles.length === 0) return null;

  const rateLimitThrows = options.rateLimitThrows ?? true;
  const igUserId =
    options.igUserId ||
    (await remember(readerIds, `${token}\n${rateLimitThrows}`, READER_ID_TTL_MS, false, () =>
      resolveIgUserId(token, signal, { rateLimitThrows, onHeaders: options.onHeaders }),
    ));
  if (!igUserId) return null;
  const read = { ...options, rateLimitThrows, igUserId };

  for (const handle of handles) {
    let found: Awaited<ReturnType<typeof walkForPost>>;
    try {
      found = await walkForPost(handle, shortcode, token, signal, read, 1, false);
    } catch (err) {
      if (err instanceof InstagramNoSuchAccountError) continue;
      throw err;
    }
    if (found && found !== "not-found" && found !== "out-of-pages") {
      return { handle: normalizeUsername(handle), post: found };
    }
  }
  return null;
}

async function walkForPost(
  username: string,
  shortcode: string,
  token: string,
  signal: AbortSignal | undefined,
  options: Omit<DiscoveryReadOptions, "noSuchAccountThrows">,
  pages: number,
  fresh: boolean,
): Promise<(IgPublicPost & { authorFollowers?: number }) | null | "not-found" | "out-of-pages"> {
  let cursor: string | undefined;
  let followers: number | undefined;

  for (let page = 0; page < pages; page++) {
    /* Throws on the first page only: once a page has answered, the account
       exists, and a later 110 would be about something else. */
    const after = cursor;
    const profile = await remember(
      postPages,
      pageKey(token, username, after, options.rateLimitThrows ?? false, page === 0),
      POST_PAGE_TTL_MS,
      fresh,
      () => fetchInstagramProfile(username, token, signal, after, { ...options, noSuchAccountThrows: page === 0 }),
    );
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
    if (!profile.nextMediaCursor) return "not-found";
    cursor = profile.nextMediaCursor;
  }
  return "out-of-pages";
}
