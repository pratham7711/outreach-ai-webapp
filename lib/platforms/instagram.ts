import { createLogger } from "@/lib/observability/logger";

const GRAPH_BASE = "https://graph.facebook.com/v19.0";
const MEDIA_PAGE_LIMIT = 50;
const MAX_MEDIA_PAGES = 5;

export type InstagramCounts = {
  thumbnailUrl: string | null;
  caption: string | null;
  viewsCount?: number;
  likesCount?: number;
  commentsCount?: number;
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

/**
 * One Graph read.
 *
 * Still returns null on every failure -- four call sites depend on that, and
 * throwing from here would put an unhandled rejection in the middle of a
 * campaign refresh. What changed is that the failure is no longer SILENT.
 *
 * It used to swallow the response body entirely, so an expired token (Meta
 * error code 190), a throttle (4, 17, 32), a permissions gap (10, 200 -- what a
 * missing pages_show_list produces) and a genuinely absent object all reduced
 * to the same `null`. Downstream that null is reported as
 * "not-a-professional-account", so the run record blamed the creator's
 * Instagram settings for what was actually our expired credential, and there
 * was nothing in the logs to contradict it. Diagnosing "Instagram sync is not
 * working" in production meant guessing between four unrelated causes.
 *
 * The code and message Meta returns are precise. Logging them costs one line
 * and is the difference between a guess and a fix.
 */
export async function graphGet(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<any | null> {
  const log = createLogger({ context: { platform: "INSTAGRAM", call: "graph", path } });
  const url = new URL(`${GRAPH_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const res = await fetch(url.toString(), { signal });
    if (!res.ok) {
      /* The body, not just the status. Meta answers 400 for an expired token
         and 400 for a bad field name, and only the error object distinguishes
         them. Never the token: params carries access_token and this must not
         put a live credential in the log. */
      const body = (await res.json().catch(() => null)) as {
        error?: { code?: unknown; error_subcode?: unknown; type?: unknown; message?: unknown };
      } | null;
      const error = body?.error ?? {};
      log.error("Graph request failed", {
        status: res.status,
        code: error.code ?? null,
        subcode: error.error_subcode ?? null,
        type: error.type ?? null,
        message: typeof error.message === "string" ? error.message.slice(0, 300) : null,
        /* Named so the log says which of the four causes it was without anyone
           having to remember Meta's numbering. */
        meaning: graphErrorMeaning(error.code),
      });
      return null;
    }
    return await res.json();
  } catch (e) {
    log.error("Graph request threw", {
      error: e instanceof Error ? e.message : String(e),
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

async function fetchViews(mediaId: string, token: string, signal?: AbortSignal): Promise<number | undefined> {
  const data = await graphGet(
    `${mediaId}/insights`,
    { metric: "views", access_token: token },
    signal,
  );
  const value = data?.data?.find((d: { name?: string }) => d.name === "views")?.values?.[0]?.value;
  return typeof value === "number" ? value : undefined;
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
      const views = match.id ? await fetchViews(match.id, token, signal) : undefined;
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
        ...(typeof views === "number" ? { viewsCount: views } : {}),
        postedAt: match.timestamp ? new Date(match.timestamp) : undefined,
      };
    }

    after = data?.paging?.cursors?.after;
    if (!after) break;
  }

  return null;
}
