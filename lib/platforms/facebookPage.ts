import { graphGet, InstagramAuthError } from "./instagram";
import { createLogger } from "@/lib/observability/logger";

/**
 * The authorised-creator half of Facebook Pages.
 *
 * A creator authorises their *user* account, but a Page's content is not
 * readable with a user token: `me/accounts` returns one short-lived **Page**
 * access token per Page the creator administers, and every read below the Page
 * has to carry that token instead. So `fetchFacebookPage` returns the Page
 * token alongside the identity, and `fetchFacebookPagePosts` takes it — passing
 * the user token there returns an empty edge rather than an error, which reads
 * exactly like a Page that has never posted.
 *
 * Permissions this exercises, which is also the mapping the App Review
 * submission has to justify:
 *   pages_show_list        -> me/accounts (the Page listing, and the only way
 *                             to learn a Page id or get its token)
 *   pages_read_engagement  -> the Page's own fields: about, fan_count,
 *                             followers_count, picture, verification_status
 *   pages_read_user_content-> /{post-id}/comments — content written by OTHER
 *                             people on the Page. This entry used to name the
 *                             /posts edge, and that was the mistake that kept
 *                             the permission unapprovable: /posts and the
 *                             comments *summary* are both credited to
 *                             pages_read_engagement, so Meta's testing counter
 *                             for pages_read_user_content read "0 of 1 API
 *                             call" while the app looked, to us, like it was
 *                             using it. A summary total is engagement data; the
 *                             comment bodies are user content, and only the
 *                             comments edge itself reads them.
 *   read_insights          -> post_media_view, the only view count Facebook
 *                             does not hang off the post object itself
 */

const PAGE_FIELDS = [
  "id",
  "name",
  "username",
  "link",
  "about",
  "fan_count",
  "followers_count",
  "verification_status",
  "picture{url}",
  /* The per-Page token. Never logged, never returned to the browser. */
  "access_token",
].join(",");

const POST_FIELDS = [
  "id",
  "message",
  "created_time",
  "permalink_url",
  "full_picture",
  /* shares is an object with a count, not a number. */
  "shares",
  /* limit(0) asks for the totals without dragging every comment and reaction
     across the wire — the summary is the only part we render. */
  "comments.summary(true).limit(0)",
  "likes.summary(true).limit(0)",
].join(",");

const POSTS_LIMIT = 12;

export type FacebookPageInfo = {
  pageId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  profileLink: string | null;
  isVerified: boolean;
  followerCount: number;
  /** Facebook publishes no post count on the Page object, so this is null
   *  rather than a 0 that would read as "has never posted". */
  mediaCount: number | null;
  /** Required for every read below the Page. Not an identity field. */
  pageAccessToken: string;
};

export type FacebookPagePost = {
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
  /** Uncoerced counters — see the note on TikTokVideo.exact. A metric the Page
   *  did not return must stay absent rather than be written as a measured 0. */
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

/** First line of the post text, since Facebook posts carry no title. */
function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

/**
 * Resolves the Page behind the creator's token.
 *
 * Takes the first Page the creator administers. A creator with several Pages
 * gets the first one Facebook lists; picking between them needs a UI that does
 * not exist yet, and silently merging them would attribute one Page's numbers
 * to another.
 */
export async function fetchFacebookPage(
  token: string,
  signal?: AbortSignal,
): Promise<FacebookPageInfo | null> {
  const log = createLogger({
    context: { platform: "FACEBOOK", call: "page.fetch" },
  });

  const data = await graphGet(
    "me/accounts",
    { fields: PAGE_FIELDS, access_token: token, limit: "50" },
    signal,
  );

  const pages: unknown[] = Array.isArray(data?.data) ? data.data : [];
  const page = pages.find(
    (p): p is Record<string, unknown> =>
      typeof p === "object" && p !== null && typeof (p as { id?: unknown }).id === "string",
  );

  if (!page) {
    log.warn("Token carries no Facebook Page", { pagesSeen: pages.length });
    return null;
  }

  const pageAccessToken =
    typeof page.access_token === "string" ? page.access_token : null;
  if (!pageAccessToken) {
    /* Without it nothing below the Page is readable, so a connection stored
       now would render as permanently empty rather than as a failure. */
    log.warn("Page returned no page access token; treating as unusable", {
      pageId: String(page.id),
    });
    return null;
  }

  const username = typeof page.username === "string" ? page.username : null;
  const displayName = typeof page.name === "string" ? page.name : "";
  const picture = (page.picture as { data?: { url?: unknown } } | undefined)?.data?.url;

  return {
    pageId: String(page.id),
    /* The @username is what a reader recognises; not every Page claims one, so
       the display name stands in. */
    username: username ?? displayName,
    displayName,
    avatarUrl: typeof picture === "string" ? picture : null,
    bio: typeof page.about === "string" ? page.about : null,
    profileLink:
      typeof page.link === "string"
        ? page.link
        : username
          ? `https://www.facebook.com/${username}`
          : null,
    /* Meta returns the string "blue_verified" or "not_verified" here, not a
       boolean, so anything other than an explicit not_verified/absent counts. */
    isVerified:
      typeof page.verification_status === "string" &&
      page.verification_status !== "not_verified",
    /* followers_count is the modern field; fan_count is the older "likes" and
       is what older Pages still answer with. */
    followerCount: num(page.followers_count) || num(page.fan_count),
    mediaCount: null,
    pageAccessToken,
  };
}

/**
 * `post_media_view` for one post (post_impressions is deprecated above Graph v25
 * and answers 400, which is why Facebook views rendered null on prod).
 *
 * Facebook puts reactions, comments and shares on the post object but not a
 * view count, so this is a second call per post — the same shape as Instagram's
 * insights edge. A failure returns an empty object rather than zeros, so an
 * unreadable metric never becomes a measured one.
 */
async function fetchPostImpressions(
  postId: string,
  pageToken: string,
  signal?: AbortSignal,
): Promise<number | undefined> {
  try {
    const data = await graphGet(
      `${postId}/insights`,
      { metric: "post_media_view", access_token: pageToken },
      signal,
    );
    const entry = Array.isArray(data?.data) ? data.data[0] : null;
    const values = Array.isArray(entry?.values) ? entry.values : [];
    return optNum(values[0]?.value);
  } catch (err) {
    /* An auth failure on insights means read_insights was not granted, which
       is a scope problem for the whole connection, not for this one post. */
    if (err instanceof InstagramAuthError) throw err;
    return undefined;
  }
}

/**
 * The Page's recent posts.
 *
 * `null` means the edge itself failed, which the portal reports as reconnect;
 * an empty array means the Page has published nothing.
 */
export async function fetchFacebookPagePosts(
  pageId: string,
  pageAccessToken: string,
  signal?: AbortSignal,
): Promise<FacebookPagePost[] | null> {
  const data = await graphGet(
    `${pageId}/posts`,
    {
      fields: POST_FIELDS,
      access_token: pageAccessToken,
      limit: String(POSTS_LIMIT),
    },
    signal,
  );
  if (!data || !Array.isArray(data.data)) return null;

  const posts: Record<string, unknown>[] = data.data.filter(
    (p: unknown): p is Record<string, unknown> =>
      typeof p === "object" && p !== null,
  );

  return await Promise.all(
    posts.map(async (post) => {
      const id = String(post.id ?? "");
      const message = typeof post.message === "string" ? post.message : "";
      const created =
        typeof post.created_time === "string" ? post.created_time : null;

      const likes = optNum(
        (post.likes as { summary?: { total_count?: unknown } } | undefined)?.summary
          ?.total_count,
      );
      const comments = optNum(
        (post.comments as { summary?: { total_count?: unknown } } | undefined)
          ?.summary?.total_count,
      );
      const shares = optNum(
        (post.shares as { count?: unknown } | undefined)?.count,
      );
      const views = await fetchPostImpressions(id, pageAccessToken, signal);

      return {
        id,
        title: firstLine(message),
        description: message,
        coverImageUrl:
          typeof post.full_picture === "string" ? post.full_picture : null,
        shareUrl:
          typeof post.permalink_url === "string" ? post.permalink_url : null,
        postedAt: created ?? new Date().toISOString(),
        viewsCount: num(views),
        likesCount: num(likes),
        commentsCount: num(comments),
        sharesCount: num(shares),
        exact: {
          views,
          likes,
          comments,
          shares,
          ...(created ? { createdAt: new Date(created) } : {}),
        },
      };
    }),
  );
}

/** How many comment bodies a live read pulls back. Deliberately small: this is
 *  a preview beside a count, not a comment browser, and every extra row is
 *  another person's words held in memory for longer than the response. */
const COMMENT_PREVIEW_LIMIT = 5;

export type FacebookCommentPreview = {
  id: string;
  /** The comment body. Never persisted — see fetchFacebookPostComments. */
  message: string;
  /** The commenter's display name, or null when Facebook withholds it. */
  authorName: string | null;
  createdAt: string | null;
  likeCount: number | null;
};

export type FacebookPostComments = {
  /**
   * Every top-level comment, from the edge's own summary — not the length of
   * `preview`, which is capped. `null` means Facebook did not return a total.
   */
  total: number | null;
  preview: FacebookCommentPreview[];
};

/**
 * Reads the comments on one Page post, live.
 *
 * This is the only call in the codebase that exercises
 * `pages_read_user_content`, and the reason it exists as its own function
 * rather than another field on POST_FIELDS: `comments.summary(true).limit(0)`
 * asks for a count and Meta credits that to pages_read_engagement, so the
 * permission we submitted had no call behind it. Reading the comment *bodies*
 * off the edge is what the permission actually governs.
 *
 * **Nothing here is persisted, and that is a commitment made to Meta in the
 * submission's justification, not an implementation detail.** These are third
 * parties who commented on a creator's Page and never agreed to be in our
 * database. The caller renders the result and drops it; there is no column, no
 * cache and no log line carrying a comment body. If a future change wants to
 * store one, that is a new review with a new justification.
 *
 * Returns null when the edge itself failed, so "could not read" stays
 * distinguishable from "nobody has commented".
 */
export async function fetchFacebookPostComments(
  postId: string,
  pageAccessToken: string,
  signal?: AbortSignal,
): Promise<FacebookPostComments | null> {
  const log = createLogger({
    context: { platform: "FACEBOOK", call: "post.comments" },
  });

  const data = await graphGet(
    `${postId}/comments`,
    {
      fields: "id,message,created_time,like_count,from{name}",
      /* Top-level only: replies hang off each comment's own edge, and counting
         them in a figure labelled "comments" would not match what the reader
         sees on Facebook. */
      filter: "toplevel",
      /* The count must not be the length of the preview — a post with 400
         comments would otherwise report 5. */
      summary: "true",
      order: "reverse_chronological",
      limit: String(COMMENT_PREVIEW_LIMIT),
      access_token: pageAccessToken,
    },
    signal,
  );
  if (!data) return null;

  const rows: Record<string, unknown>[] = Array.isArray(data.data)
    ? data.data.filter(
        (c: unknown): c is Record<string, unknown> =>
          typeof c === "object" && c !== null,
      )
    : [];

  const total = optNum(
    (data.summary as { total_count?: unknown } | undefined)?.total_count,
  );

  /* Counted, not quoted. A comment body must not reach a log even at debug:
     the whole argument for this function is that these words stay in the
     response. */
  log.info("Read Page post comments live", {
    postId,
    returned: rows.length,
    total: total ?? null,
  });

  return {
    total: total ?? null,
    preview: rows.map((c) => {
      const from = c.from as { name?: unknown } | undefined;
      return {
        id: String(c.id ?? ""),
        message: typeof c.message === "string" ? c.message : "",
        /* Facebook omits `from` for a commenter who has not authorised the app
           — the common case since the 2018 platform changes — so an anonymous
           comment is normal, not an error. */
        authorName: typeof from?.name === "string" && from.name ? from.name : null,
        createdAt: typeof c.created_time === "string" ? c.created_time : null,
        likeCount: optNum(c.like_count) ?? null,
      };
    }),
  };
}

/**
 * Withdraws the app's access, as the data-deletion and disconnect paths need.
 *
 * Revokes the *user* grant, not the Page token: dropping the user's permissions
 * invalidates every Page token minted from it.
 */
export async function revokeFacebookToken(token: string): Promise<boolean> {
  const log = createLogger({
    context: { platform: "FACEBOOK", call: "permissions.revoke" },
  });
  try {
    const res = await fetch(
      `https://graph.facebook.com/v26.0/me/permissions?access_token=${encodeURIComponent(token)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      log.warn("Revoke failed", { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    log.warn("Revoke threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}
