import { createLogger } from "@/lib/observability/logger";
import { clientCredentialsFor } from "@/lib/oauth/providers";

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
  /* Insights-only, and reels-only in practice. Instagram publishes no share
     count on any public endpoint -- not oEmbed, not the embed page, not
     Business Discovery -- so this arrives for a creator who has connected
     their account and for nobody else. */
  sharesCount?: number;
  /* Insights-only, same as shares. "saved" is the bookmark count, the figure
     CreatorCore's report calls Total Saves. */
  savesCount?: number;
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
 * Meta throttled us. Thrown only to callers that ask (`rateLimitThrows`), because
 * to everyone else it has always been one more null -- and to the roster read a
 * null means "this account is personal", which is a permanent-sounding answer
 * for what is only a busy hour.
 */
export class InstagramRateLimitError extends Error {
  constructor(readonly code: number) {
    super(`Graph rate limit (#${code})`);
    this.name = "InstagramRateLimitError";
  }
}

const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

export function isRateLimitCode(code: unknown): code is number {
  return typeof code === "number" && RATE_LIMIT_CODES.has(code);
}

/**
 * Business Discovery found no Business or Creator account under the name we
 * asked about: Graph error 110, "Invalid user id". Thrown only to callers that
 * ask (`noSuchAccountThrows`), for the same reason as the rate limit above --
 * everywhere else it has always been one more null.
 *
 * It is an answer about a NAME, not about a post. The account may be deleted,
 * renamed, personal or private, or the name may simply be the wrong one; Graph
 * says the same thing for all five.
 */
export class InstagramNoSuchAccountError extends Error {
  constructor(readonly subcode: number | undefined) {
    super("Business Discovery found no Business or Creator account by that name (#110)");
    this.name = "InstagramNoSuchAccountError";
  }
}

const NO_SUCH_ACCOUNT_CODE = 110;

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

function requestSignal(walk: AbortSignal | undefined, timeoutMs: number): AbortSignal | undefined {
  if (typeof AbortSignal === "undefined" || typeof AbortSignal.timeout !== "function") {
    return walk;
  }
  const perRequest = AbortSignal.timeout(timeoutMs);
  if (!walk) return perRequest;
  return typeof AbortSignal.any === "function" ? AbortSignal.any([walk, perRequest]) : perRequest;
}

/**
 * Sees the response headers of a Graph call, success or failure alike.
 *
 * Meta reports how close a token is to its limit in two headers
 * (x-app-usage, x-business-use-case-usage) on every answer, not only on the
 * one that finally refuses -- so this is how a caller sees the limit coming
 * (lib/platforms/instagramDiscoveryTokens.ts). Only callers that pass one get
 * their headers read; everyone else is untouched.
 */
export type GraphHeadersListener = (headers: { get(name: string): string | null }) => void;

export type GraphGetOptions = {
  rateLimitThrows?: boolean;
  noSuchAccountThrows?: boolean;
  onHeaders?: GraphHeadersListener;
  /* The per-request budget, for a call Meta is known to answer slowly. An IG
     User's count fields took 4.1-8.7s on 2026-10-25 while the same object's
     other fields answered in ~0.5s, so one deadline cannot suit both. */
  timeoutMs?: number;
};

export async function graphGet(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
  {
    rateLimitThrows = false,
    noSuchAccountThrows = false,
    onHeaders,
    timeoutMs = GRAPH_REQUEST_TIMEOUT_MS,
  }: GraphGetOptions = {},
): Promise<any | null> {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const log = createLogger({ context: { platform: "INSTAGRAM", call: `graph.${path}` } });
  try {
    const res = await fetch(url.toString(), { signal: requestSignal(signal, timeoutMs) });
    if (onHeaders && typeof res.headers?.get === "function") {
      /* A listener is monitoring. Whatever it does wrong must not turn a good
         answer into a failed read. */
      try {
        onHeaders(res.headers);
      } catch {
        // ignored on purpose
      }
    }
    if (!res.ok) {
      // Every failure here collapses to null, so an expired token, a missing
      // scope and a genuinely empty result are indistinguishable to callers.
      // Log the Graph error code so the difference is at least recoverable.
      let code: unknown;
      let subcode: unknown;
      let message: unknown;
      try {
        const body = await res.json();
        code = body?.error?.code;
        subcode = body?.error?.error_subcode;
        message = body?.error?.message;
      } catch {
        // non-JSON error body; status alone has to do
      }
      log.error("Graph request failed", {
        status: res.status,
        code,
        subcode,
        message,
        /* Named so the log says which of the causes it was without anyone
           having to remember Meta's numbering. Never the token: params carries
           access_token and this must not put a live credential in the log. */
        meaning: graphErrorMeaning(code),
      });
      /* A throttle is tested BEFORE the status rule below. Meta sends its app
         limit (#4, "Application request limit reached") as HTTP 403, and with
         the 403 test first every throttled Business Discovery call was filed as
         "INSTAGRAM_BUSINESS_TOKEN rejected" -- measured 2026-10-02/03, when it
         was the only error the refresh windows logged and the token was fine. */
      if (isRateLimitCode(code)) {
        if (rateLimitThrows) throw new InstagramRateLimitError(code);
        return null;
      }
      if (isAuthFailure(res.status, code)) {
        throw new InstagramAuthError(
          res.status,
          typeof code === "number" ? code : undefined,
          typeof message === "string" ? message : `Graph auth failure (${res.status})`,
        );
      }
      if (noSuchAccountThrows && code === NO_SUCH_ACCOUNT_CODE) {
        throw new InstagramNoSuchAccountError(typeof subcode === "number" ? subcode : undefined);
      }
      return null;
    }
    return await res.json();
  } catch (err) {
    if (
      err instanceof InstagramAuthError ||
      err instanceof InstagramRateLimitError ||
      err instanceof InstagramNoSuchAccountError
    ) {
      throw err;
    }
    /* An abort is ours, so it is named and thrown rather than folded in with
       Graph 500s and empty results. AbortSignal.timeout raises TimeoutError;
       an explicitly aborted caller signal raises AbortError. */
    const name = err instanceof Error ? err.name : "";
    if (name === "TimeoutError" || name === "AbortError") {
      log.warn("Graph request timed out", { timeoutMs, error: name });
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
    case NO_SUCH_ACCOUNT_CODE:
      return "no-such-account: Business Discovery has no Business or Creator account by that name";
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

/** More than any one creator or agency grants; a cap on the reads an empty me/accounts can cost. */
const MAX_GRANTED_PAGES = 10;

/**
 * The Pages a Facebook Login grant reaches, in me/accounts' shape (each read
 * with `fields`, plus its id).
 *
 * me/accounts can answer [] for a grant that names its Pages. Measured
 * 2026-10-25 for a review Page after its admin re-authorised: the token's
 * granular_scopes targeted the Page and /{page-id} returned it with a Page
 * token and its Instagram account, while me/accounts answered [] on v23 and
 * v26 alike, so every connect failed as "no Instagram account". An empty
 * me/accounts therefore falls back to the Pages the grant itself names. A
 * grant opted in to "all current and future Pages" names none, so it stays
 * empty -- the connect copy (no_page) tells the person which choice to make.
 */
export async function listGrantedPages(
  token: string,
  fields: string,
  signal?: AbortSignal,
  options: Pick<GraphGetOptions, "rateLimitThrows" | "onHeaders"> = {},
): Promise<Array<Record<string, unknown>>> {
  const data = await graphGet(
    "me/accounts",
    { fields, access_token: token, limit: "50" },
    signal,
    options,
  );
  const listed: unknown[] = Array.isArray(data?.data) ? data.data : [];
  if (listed.length > 0) return listed as Array<Record<string, unknown>>;

  const pages: Array<Record<string, unknown>> = [];
  for (const id of (await grantedPageIds(token, signal)).slice(0, MAX_GRANTED_PAGES)) {
    const page = await graphGet(id, { fields, access_token: token }, signal, options);
    if (page && typeof page.id === "string") pages.push(page);
  }
  return pages;
}

/**
 * The Page ids a user token's granular scopes name, or [] when it names none
 * or Meta will not say. debug_token needs the app's own token; the secret
 * travels only in this request and graphGet never logs params.
 */
async function grantedPageIds(token: string, signal?: AbortSignal): Promise<string[]> {
  const creds = clientCredentialsFor("instagram") ?? clientCredentialsFor("facebook");
  if (!creds) return [];
  try {
    const data = await graphGet(
      "debug_token",
      { input_token: token, access_token: `${creds.clientId}|${creds.clientSecret}` },
      signal,
    );
    const scopes: unknown[] = Array.isArray(data?.data?.granular_scopes) ? data.data.granular_scopes : [];
    const ids = new Set<string>();
    for (const s of scopes as Array<{ scope?: unknown; target_ids?: unknown }>) {
      if (typeof s?.scope !== "string" || !s.scope.startsWith("pages_") || !Array.isArray(s.target_ids)) continue;
      for (const id of s.target_ids) if (typeof id === "string" && /^\d+$/.test(id)) ids.add(id);
    }
    return [...ids];
  } catch {
    return [];
  }
}

/**
 * The IG user id behind a token, from the Pages it manages.
 *
 * `options` reaches graphGet unchanged. A Business Discovery read asks this
 * first, so when its token is throttled this is the call that is refused --
 * and without rateLimitThrows reaching it, that refusal came back as "no IG
 * account", which the roster read files as a personal account.
 */
export async function resolveIgUserId(
  token: string,
  signal?: AbortSignal,
  options: Pick<GraphGetOptions, "rateLimitThrows" | "onHeaders"> = {},
): Promise<string | null> {
  let pages: Array<{ instagram_business_account?: { id?: string } }> = [];
  let pagesError: unknown = null;
  try {
    pages = (await listGrantedPages(
      token,
      "instagram_business_account{id}",
      signal,
      options,
    )) as typeof pages;
  } catch (err) {
    if (!(err instanceof InstagramAuthError)) throw err;
    pagesError = err;
  }
  for (const page of pages) {
    const igId = page.instagram_business_account?.id;
    if (igId) return igId;
  }
  const assigned = await assignedInstagramAccountIds(token, signal, options, pagesError);
  return assigned[0] ?? null;
}

/**
 * The Instagram accounts a Unified login token was granted, read off
 * `me/assigned_instagram_accounts`. That token is a business-integration
 * system-user token: it holds no Page, so the Pages edge either answers empty
 * or refuses it outright (#200, which graphGet throws as an auth failure).
 *
 * `pagesError` is the refusal the Pages edge gave, if any. When this edge
 * refuses too, the token itself is dead or lacks the grant, and the Pages
 * error is the one rethrown, so a revoked Facebook Login token keeps failing
 * exactly as it did before this fallback existed.
 */
/* Measured 2026-11-09 on a fresh Unified login token: this edge did not answer
   inside the default 5s deadline, and the connect failed on it. */
const ASSIGNED_ACCOUNTS_TIMEOUT_MS = 20_000;

export async function assignedInstagramAccountIds(
  token: string,
  signal?: AbortSignal,
  options: Pick<GraphGetOptions, "rateLimitThrows" | "onHeaders"> = {},
  pagesError: unknown = null,
): Promise<string[]> {
  let data: { data?: unknown } | null = null;
  try {
    data = await graphGet(
      "me/assigned_instagram_accounts",
      { fields: "id", access_token: token, limit: "25" },
      signal,
      { ...options, timeoutMs: ASSIGNED_ACCOUNTS_TIMEOUT_MS },
    );
  } catch (err) {
    if (pagesError && err instanceof InstagramAuthError) throw pagesError;
    throw err;
  }
  if (!data && pagesError) throw pagesError;
  const rows: unknown[] = Array.isArray(data?.data) ? data.data : [];
  return rows
    .map((r) => (r as { id?: unknown })?.id)
    .filter((id): id is string => typeof id === "string" && /^\d+$/.test(id));
}

/**
 * Every per-media insight we can get, in as few round trips as the endpoint
 * allows.
 *
 * All four metrics are asked for together because this endpoint bills per call,
 * not per metric, so splitting them would multiply the cost of the media walk
 * for nothing. Each is parsed independently: an image publishes no play count,
 * reach is absent until Meta App Review lands, and shares is reels-only -- so a
 * missing one must not discard the rest.
 *
 * The ladder is not defensive padding. Instagram rejects the WHOLE request
 * (400, "Invalid parameter") when any one metric is unsupported for that
 * media's type, rather than omitting the offending metric -- measured in
 * instagramAccount.ts, where asking for `views,shares` on a non-reel answered
 * nothing at all. So the widest set is tried first, and each rung drops the
 * metrics most likely to be the one being refused.
 *
 * Everything stays `undefined` when absent rather than becoming 0 -- a measured
 * zero and "Instagram did not tell us" are different facts, and the seal stores
 * whichever one it is permanently.
 */
const INSIGHT_LADDER = ["views,reach,shares,saved", "views,reach", "views"] as const;

async function fetchInsights(
  mediaId: string,
  token: string,
  signal?: AbortSignal,
): Promise<{ views?: number; reach?: number; shares?: number; saved?: number }> {
  let data: any = null;
  for (const metric of INSIGHT_LADDER) {
    data = await graphGet(`${mediaId}/insights`, { metric, access_token: token }, signal).catch(
      (err) => {
        /* An auth failure must reach the caller: the token or the scope is
           gone, and every later media would fail identically. A timeout must
           too, or a slow endpoint is waited on once per rung and one stalled
           media costs three full timeouts instead of one. Anything else is
           this media's own metric set, and the next rung may still answer. */
        if (err instanceof InstagramAuthError || err instanceof InstagramTimeoutError) throw err;
        return null;
      },
    );
    if (data) break;
  }
  if (!data) return {};

  const read = (name: string): number | undefined => {
    const value = data?.data?.find((d: { name?: string }) => d.name === name)?.values?.[0]?.value;
    return typeof value === "number" ? value : undefined;
  };
  const views = read("views");
  const reach = read("reach");
  const shares = read("shares");
  const saved = read("saved");
  return {
    ...(views === undefined ? {} : { views }),
    ...(reach === undefined ? {} : { reach }),
    ...(shares === undefined ? {} : { shares }),
    ...(saved === undefined ? {} : { saved }),
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
        ...(typeof insights.shares === "number" ? { sharesCount: insights.shares } : {}),
        ...(typeof insights.saved === "number" ? { savesCount: insights.saved } : {}),
        postedAt: match.timestamp ? new Date(match.timestamp) : undefined,
      };
    }

    after = data?.paging?.cursors?.after;
    if (!after) break;
  }

  return null;
}
