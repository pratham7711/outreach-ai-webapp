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

export async function graphGet(
  path: string,
  params: Record<string, string>,
  signal?: AbortSignal,
): Promise<any | null> {
  const url = new URL(`${GRAPH_BASE}/${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  try {
    const res = await fetch(url.toString(), { signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
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
