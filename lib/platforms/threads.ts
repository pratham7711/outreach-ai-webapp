import { createLogger } from "@/lib/observability/logger";

/**
 * The authorised-creator half of Threads.
 *
 * Threads is NOT on the Facebook Graph host. It has its own API at
 * graph.threads.net with its own app id, its own token endpoint and its own
 * scope names, so none of instagram.ts applies here — hence the local request
 * helper rather than a reuse of `graphGet`.
 *
 * Permissions this exercises, which is the mapping the App Review submission
 * has to justify:
 *   threads_basic            -> me (identity) and me/threads (the post list)
 *   threads_manage_insights  -> per-post views/likes/replies/reposts/quotes,
 *                               and the account's follower count, which Threads
 *                               publishes ONLY through the insights edge —
 *                               there is no followers field on the profile
 *
 * Two counters have no Threads equivalent and stay null rather than 0: there is
 * no following count and no lifetime like total.
 */

const THREADS_BASE = "https://graph.threads.net/v1.0";
const REQUEST_TIMEOUT_MS = 10_000;

const PROFILE_FIELDS = [
  "id",
  "username",
  "name",
  "threads_profile_picture_url",
  "threads_biography",
].join(",");

const POST_FIELDS = [
  "id",
  "media_type",
  "media_url",
  "permalink",
  "text",
  "timestamp",
  "thumbnail_url",
].join(",");

/** Per-post metrics, all behind threads_manage_insights. */
const POST_METRICS = ["views", "likes", "replies", "reposts", "quotes"].join(",");

const POSTS_LIMIT = 12;

export type ThreadsProfileInfo = {
  threadsUserId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  profileLink: string | null;
  /** The Threads API exposes no verified flag — a limit of the API, not a
   *  claim about the account. Kept so every platform renders through one type. */
  isVerified: boolean;
  /** Null when the insights edge would not answer, which is distinct from an
   *  account that genuinely has no followers. */
  followerCount: number | null;
  /** Threads publishes no post count on the profile. */
  mediaCount: number | null;
};

export type ThreadsPost = {
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
  /** Uncoerced counters — see the note on TikTokVideo.exact. */
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

function firstLine(text: string): string {
  return text.split("\n")[0] ?? "";
}

function requestSignal(walk?: AbortSignal): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") {
    return walk;
  }
  const perRequest = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
  if (!walk) return perRequest;
  return typeof AbortSignal.any === "function"
    ? AbortSignal.any([walk, perRequest])
    : perRequest;
}

/**
 * One Threads read.
 *
 * Collapses every failure to null and logs the API's own error code, so a
 * missing scope stays distinguishable from an empty result in the logs even
 * though callers cannot tell them apart. The access token goes in the query
 * string because that is the only form this API accepts — so it must never be
 * logged, and only `path` is.
 */
async function threadsGet(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<any | null> {
  const url = new URL(`${THREADS_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const log = createLogger({
    context: { platform: "THREADS", call: `threads.${path}` },
  });
  try {
    const res = await fetch(url.toString(), { signal: requestSignal(signal) });
    if (!res.ok) {
      let code: unknown;
      let message: unknown;
      try {
        const body = await res.json();
        code = body?.error?.code;
        message = body?.error?.message;
      } catch {
        /* non-JSON error body; the status alone has to do */
      }
      log.error("Threads request failed", { status: res.status, code, message });
      return null;
    }
    return await res.json();
  } catch (err) {
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      log.warn("Threads request timed out", { timeoutMs: REQUEST_TIMEOUT_MS, error: name });
      return null;
    }
    log.error("Threads request threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * The follower count, which lives on the insights edge and nowhere else.
 *
 * Returns null rather than 0 when the edge will not answer — a brand-new
 * account genuinely has 0 followers, and the two must stay distinguishable.
 */
async function fetchFollowerCount(
  token: string,
  signal?: AbortSignal,
): Promise<number | null> {
  const data = await threadsGet(
    "me/threads_insights",
    { metric: "followers_count", access_token: token },
    signal,
  );
  const entry = Array.isArray(data?.data) ? data.data[0] : null;
  /* This metric is a lifetime total, so it arrives as `total_value`, not as the
     time-series `values` array the per-post metrics use. */
  const total = optNum(entry?.total_value?.value);
  if (total !== undefined) return total;
  const values = Array.isArray(entry?.values) ? entry.values : [];
  const latest = optNum(values[values.length - 1]?.value);
  return latest ?? null;
}

/** Resolves the Threads account behind the creator's token. */
export async function fetchThreadsProfile(
  token: string,
  signal?: AbortSignal,
): Promise<ThreadsProfileInfo | null> {
  const log = createLogger({
    context: { platform: "THREADS", call: "profile.fetch" },
  });

  const profile = await threadsGet(
    "me",
    { fields: PROFILE_FIELDS, access_token: token },
    signal,
  );
  if (!profile || typeof profile.id !== "string") {
    log.warn("Token carries no Threads profile");
    return null;
  }

  const username = typeof profile.username === "string" ? profile.username : "";
  const followerCount = await fetchFollowerCount(token, signal);

  return {
    threadsUserId: profile.id,
    username,
    displayName: typeof profile.name === "string" ? profile.name : username,
    avatarUrl:
      typeof profile.threads_profile_picture_url === "string"
        ? profile.threads_profile_picture_url
        : null,
    bio:
      typeof profile.threads_biography === "string"
        ? profile.threads_biography
        : null,
    profileLink: username ? `https://www.threads.net/@${username}` : null,
    isVerified: false,
    followerCount,
    mediaCount: null,
  };
}

/**
 * Per-post metrics from the insights edge.
 *
 * `replies` is the comment equivalent. `reposts` and `quotes` are two distinct
 * ways to share a thread, so the share count is their sum — but only when at
 * least one of them answered, so a post whose insights failed stays absent from
 * `exact` rather than being recorded as zero shares.
 */
type ThreadsInsights = {
  views?: number;
  likes?: number;
  replies?: number;
  shares?: number;
};

async function fetchPostInsights(
  postId: string,
  token: string,
  signal?: AbortSignal,
): Promise<ThreadsInsights> {
  const data = await threadsGet(
    `${postId}/insights`,
    { metric: POST_METRICS, access_token: token },
    signal,
  );
  const entries: Record<string, unknown>[] = Array.isArray(data?.data)
    ? data.data
    : [];

  const read = (name: string): number | undefined => {
    const entry = entries.find((e) => e.name === name);
    if (!entry) return undefined;
    const total = optNum(
      (entry.total_value as { value?: unknown } | undefined)?.value,
    );
    if (total !== undefined) return total;
    const values = Array.isArray(entry.values) ? entry.values : [];
    return optNum(values[0]?.value);
  };

  const reposts = read("reposts");
  const quotes = read("quotes");
  const shares =
    reposts === undefined && quotes === undefined
      ? undefined
      : (reposts ?? 0) + (quotes ?? 0);

  return {
    views: read("views"),
    likes: read("likes"),
    replies: read("replies"),
    shares,
  };
}

/**
 * The creator's recent threads.
 *
 * `null` means the post edge itself failed, which the portal reports as
 * reconnect; an empty array means they have posted nothing.
 */
export async function fetchThreadsPosts(
  token: string,
  signal?: AbortSignal,
): Promise<ThreadsPost[] | null> {
  const data = await threadsGet(
    "me/threads",
    { fields: POST_FIELDS, access_token: token, limit: String(POSTS_LIMIT) },
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
      const text = typeof post.text === "string" ? post.text : "";
      const created = typeof post.timestamp === "string" ? post.timestamp : null;
      const insights = await fetchPostInsights(id, token, signal);

      return {
        id,
        title: firstLine(text),
        description: text,
        coverImageUrl:
          typeof post.thumbnail_url === "string"
            ? post.thumbnail_url
            : typeof post.media_url === "string"
              ? post.media_url
              : null,
        shareUrl: typeof post.permalink === "string" ? post.permalink : null,
        postedAt: created ?? new Date().toISOString(),
        viewsCount: num(insights.views),
        likesCount: num(insights.likes),
        commentsCount: num(insights.replies),
        sharesCount: num(insights.shares),
        exact: {
          views: insights.views,
          likes: insights.likes,
          comments: insights.replies,
          shares: insights.shares,
          ...(created ? { createdAt: new Date(created) } : {}),
        },
      };
    }),
  );
}

/**
 * Trades the short-lived authorisation token for a long-lived one.
 *
 * Threads short-lived tokens last about an hour; the long-lived one lasts 60
 * days. Unlike Instagram this is a GET on a bare host path, not a v1.0 edge,
 * and it takes the client secret — so it belongs here and not in the shared
 * OAuth code.
 */
export type LongLivedThreadsToken = {
  accessToken: string;
  expiresAt: Date | null;
};

export async function exchangeThreadsToken(
  shortLivedToken: string,
): Promise<LongLivedThreadsToken | null> {
  const secret = process.env.THREADS_CLIENT_SECRET;
  const log = createLogger({
    context: { platform: "THREADS", call: "token.exchange" },
  });
  if (!secret) {
    log.warn("No THREADS_CLIENT_SECRET configured; cannot exchange token");
    return null;
  }

  const url = new URL("https://graph.threads.net/access_token");
  url.searchParams.set("grant_type", "th_exchange_token");
  url.searchParams.set("client_secret", secret);
  url.searchParams.set("access_token", shortLivedToken);

  try {
    const res = await fetch(url.toString(), { signal: requestSignal() });
    if (!res.ok) {
      log.warn("Token exchange failed", { status: res.status });
      return null;
    }
    const body = await res.json();
    if (typeof body?.access_token !== "string") return null;
    const expiresIn = optNum(body.expires_in);
    return {
      accessToken: body.access_token,
      expiresAt:
        expiresIn !== undefined ? new Date(Date.now() + expiresIn * 1000) : null,
    };
  } catch (err) {
    log.warn("Token exchange threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Extends a long-lived token before it expires.
 *
 * Threads refreshes in place — there is no refresh token, the current access
 * token is the credential — so a token left unused for 60 days is dead and the
 * creator has to authorise again.
 */
export async function refreshThreadsToken(
  token: string,
): Promise<LongLivedThreadsToken | null> {
  const log = createLogger({
    context: { platform: "THREADS", call: "token.refresh" },
  });
  const url = new URL("https://graph.threads.net/refresh_access_token");
  url.searchParams.set("grant_type", "th_refresh_token");
  url.searchParams.set("access_token", token);

  try {
    const res = await fetch(url.toString(), { signal: requestSignal() });
    if (!res.ok) {
      log.warn("Token refresh failed", { status: res.status });
      return null;
    }
    const body = await res.json();
    if (typeof body?.access_token !== "string") return null;
    const expiresIn = optNum(body.expires_in);
    return {
      accessToken: body.access_token,
      expiresAt:
        expiresIn !== undefined ? new Date(Date.now() + expiresIn * 1000) : null,
    };
  } catch (err) {
    log.warn("Token refresh threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
