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

export async function graphGet(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<any | null> {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const log = createLogger({ context: { platform: "INSTAGRAM", call: `graph.${path}` } });
  try {
    const res = await fetch(url.toString(), { signal });
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
      log.error("Graph request failed", { status: res.status, code, message });
      return null;
    }
    return await res.json();
  } catch (err) {
    log.error("Graph request threw", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
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
        likesCount: typeof match.like_count === "number" ? match.like_count : 0,
        commentsCount: typeof match.comments_count === "number" ? match.comments_count : 0,
        viewsCount: typeof views === "number" ? views : 0,
        postedAt: match.timestamp ? new Date(match.timestamp) : undefined,
      };
    }

    after = data?.paging?.cursors?.after;
    if (!after) break;
  }

  return null;
}
