import { createLogger } from "@/lib/observability/logger";

// v19.0 stopped being usable 2026-05-21. An expired version does not error —
// Graph silently serves the next-oldest usable one, so a stale pin here is
// invisible until a field it no longer returns comes back undefined.
// v26.0 is read off Meta's versioning docs, not exercised against a live call.
const GRAPH_BASE = "https://graph.facebook.com/v26.0";
const MEDIA_PAGE_LIMIT = 50;
const MAX_MEDIA_PAGES = 5;

export type InstagramCounts = {
  thumbnailUrl: string | null;
  caption: string | null;
  viewsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  /* Optional, not defaulted: Instagram omits reach rather than sending zero,
     and a missing reach must not be sealed as a measured zero. */
  reachCount?: number;
  postedAt?: Date;
};

type GraphNode = {
  id?: string;
  permalink?: string;
  caption?: string;
  like_count?: number;
  comments_count?: number;
  thumbnail_url?: string;
  media_url?: string;
  timestamp?: string;
};

export function shortcodeFromUrl(url: string): string | null {
  const match = url.match(/instagram\.com\/(?:reel|reels|p|tv)\/([\w-]+)/);
  return match ? match[1] : null;
}

// Graph reports an unusable token as 190 (expired/invalid) or 102 (session), and
// a missing scope as 403. These are the cases a caller must not read as "this
// creator has no Instagram" — the account may be fine and the token simply dead.
const AUTH_ERROR_CODES = new Set([102, 190]);

export class InstagramAuthError extends Error {
  readonly status: number;
  readonly code: number | undefined;

  constructor(status: number, code: number | undefined, message: string) {
    super(message);
    this.name = "InstagramAuthError";
    this.status = status;
    this.code = code;
  }
}

export function isAuthFailure(status: number, code: unknown): boolean {
  if (status === 401 || status === 403) return true;
  return typeof code === "number" && AUTH_ERROR_CODES.has(code);
}

/**
 * Our own deadline ran out. Not Meta refusing us.
 *
 * Thrown rather than collapsed to null because null here is indistinguishable
 * from "Graph answered, and the post was not in the pages we walked" -- so a
 * timeout used to be filed as "platform-refused", which reads as Instagram
 * turning us away and sends someone to check a token that was never the problem.
 */
export class InstagramTimeoutError extends Error {
  constructor(readonly path: string) {
    super(`Graph request timed out: ${path}`);
    this.name = "InstagramTimeoutError";
  }
}

/**
 * How long ONE Graph round trip may take.
 *
 * Callers pass a signal covering the whole walk, and that walk is not one
 * request: resolving the IG user id, up to five pages of media and an insights
 * call is seven round trips for the creator-token path, and Business Discovery
 * re-resolves the user id per page for up to ten. All of them shared a single
 * 8-second budget, so one slow page consumed the deadline for everything behind
 * it and the walk returned empty having barely started. Each request now gets
 * its own budget, and the caller's signal still bounds the walk as a whole.
 */
const GRAPH_REQUEST_TIMEOUT_MS = 5000;

function requestSignal(walk?: AbortSignal): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") {
    return walk;
  }
  const perRequest = AbortSignal.timeout(GRAPH_REQUEST_TIMEOUT_MS);
  if (!walk) return perRequest;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([walk, perRequest]) : perRequest;
}

export async function graphGet(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<any | null> {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const log = createLogger({ context: { platform: "INSTAGRAM", call: `graph.${path}` } });
  try {
    const res = await fetch(url.toString(), { signal: requestSignal(signal) });
    if (!res.ok) {
      // Every failure here collapses to null, so an expired token, a missing
      // scope and a genuinely empty result are indistinguishable to callers.
      // Log the Graph error code so the difference is at least recoverable.
      let code: unknown;
      let message: unknown;
      try {
        const body = await res.json();
        code = body?.error?.code;
        message = body?.error?.message;
      } catch {
        // non-JSON error body; status alone has to do
      }
      log.error("Graph request failed", {
        status: res.status,
        code,
        message,
        /* Named so the log says which of the causes it was without anyone
           having to remember Meta's numbering. Never the token: params carries
           access_token and this must not put a live credential in the log. */
        meaning: graphErrorMeaning(code),
      });
      if (isAuthFailure(res.status, code)) {
        throw new InstagramAuthError(
          res.status,
          typeof code === "number" ? code : undefined,
          typeof message === "string" ? message : `Graph auth failure (${res.status})`,
        );
      }
      return null;
    }
    return await res.json();
  } catch (err) {
    if (err instanceof InstagramAuthError) throw err;
    /* An abort is ours, so it is named and thrown rather than folded in with
       Graph 500s and empty results. AbortSignal.timeout raises TimeoutError;
       an explicitly aborted caller signal raises AbortError. */
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      log.warn("Graph request timed out", { timeoutMs: GRAPH_REQUEST_TIMEOUT_MS, error: name });
      throw new InstagramTimeoutError(path);
    }
    log.error("Graph request threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/** Meta's numeric codes, in words. */
function graphErrorMeaning(code: unknown): string {
  switch (code) {
    case 190:
      return "token-expired-or-revoked: the creator must reconnect Instagram";
    case 4:
    case 17:
    case 32:
    case 613:
      return "rate-limited: retry later, not a problem with the account";
    case 10:
    case 200:
      return "permission-missing: the token lacks a required scope (pages_show_list for me/accounts)";
    case 100:
      return "bad-request: unknown field, or an object this token cannot see";
    case 803:
      return "object-not-found";
    default:
      return "unclassified";
  }
}

export type LongLivedToken = { accessToken: string; expiresAt: Date | null };

// Facebook issues no refresh_token. The only way to keep an Instagram
// connection alive is to trade a still-valid token for a fresh long-lived one;
// the short-lived token the OAuth callback receives lasts about an hour.
export async function exchangeForLongLivedToken(
  token: string,
  signal?: AbortSignal,
): Promise<LongLivedToken | null> {
  const clientId = process.env.INSTAGRAM_CLIENT_ID;
  const clientSecret = process.env.INSTAGRAM_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const data = await graphGet(
    "oauth/access_token",
    {
      grant_type: "fb_exchange_token",
      client_id: clientId,
      client_secret: clientSecret,
      fb_exchange_token: token,
    },
    signal,
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

export async function resolveIgUserId(token: string, signal?: AbortSignal): Promise<string | null> {
  const data = await graphGet(
    "me/accounts",
    { fields: "instagram_business_account{id}", access_token: token, limit: "50" },
    signal,
  );
  const pages: Array<{ instagram_business_account?: { id?: string } }> = data?.data ?? [];
  for (const page of pages) {
    const igId = page.instagram_business_account?.id;
    if (igId) return igId;
  }
  return null;
}

/**
 * Read the per-media insights we care about in ONE round trip.
 *
 * `views` and `reach` are asked for together because this endpoint bills per
 * call, not per metric, so splitting them would double the cost of the media
 * walk for nothing. Each is parsed independently: an image publishes no play
 * count, and until Meta App Review lands reach is absent on every post, so a
 * missing one of the pair must not discard the other.
 *
 * Both stay `undefined` when absent rather than becoming 0 -- a measured zero
 * and "Instagram did not tell us" are different facts, and the seal makes
 * whichever one it is stored permanently.
 */
async function fetchInsights(
  mediaId: string,
  token: string,
  signal?: AbortSignal,
): Promise<{ views?: number; reach?: number }> {
  const data = await graphGet(
    `${mediaId}/insights`,
    { metric: "views,reach", access_token: token },
    signal,
  );
  const read = (name: string): number | undefined => {
    const value = data?.data?.find((d: { name?: string }) => d.name === name)?.values?.[0]?.value;
    return typeof value === "number" ? value : undefined;
  };
  const views = read("views");
  const reach = read("reach");
  return {
    ...(views === undefined ? {} : { views }),
    ...(reach === undefined ? {} : { reach }),
  };
}

export async function fetchInstagramMetricsGraph(
  url: string,
  token: string,
  signal?: AbortSignal,
): Promise<InstagramCounts | null> {
  const shortcode = shortcodeFromUrl(url);
  if (!shortcode) return null;

  const igUserId = await resolveIgUserId(token, signal);
  if (!igUserId) return null;

  let after: string | undefined;
  for (let page = 0; page < MAX_MEDIA_PAGES; page++) {
    const params: Record<string, string> = {
      fields: "id,permalink,caption,like_count,comments_count,thumbnail_url,media_url,timestamp",
      access_token: token,
      limit: String(MEDIA_PAGE_LIMIT),
    };
    if (after) params.after = after;

    const data = await graphGet(`${igUserId}/media`, params, signal);
    const nodes: GraphNode[] = data?.data ?? [];

    const match = nodes.find(
      (n) => typeof n.permalink === "string" && n.permalink.includes(`/${shortcode}`),
    );
    if (match) {
      const insights = match.id ? await fetchInsights(match.id, token, signal) : {};
      return {
        thumbnailUrl: match.thumbnail_url ?? match.media_url ?? null,
        caption: match.caption ?? null,
        /* Omitted, not zeroed. Instagram leaves like_count out of the payload
           entirely when the creator has hidden their like counts, and coercing
           that to 0 is indistinguishable from a reel nobody liked -- which is
           how two posts with ten thousand views each came to report "0 likes"
           on a client report. Every field here is optional for this reason;
           applyPostMetrics writes only what arrived. */
        ...(typeof match.like_count === "number" ? { likesCount: match.like_count } : {}),
        ...(typeof match.comments_count === "number" ? { commentsCount: match.comments_count } : {}),
        ...(typeof insights.views === "number" ? { viewsCount: insights.views } : {}),
        ...(typeof insights.reach === "number" ? { reachCount: insights.reach } : {}),
        postedAt: match.timestamp ? new Date(match.timestamp) : undefined,
      };
    }

    after = data?.paging?.cursors?.after;
    if (!after) break;
  }

  return null;
}
