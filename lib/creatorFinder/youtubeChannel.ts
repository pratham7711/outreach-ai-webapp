import { channelThumbnail, isYouTubeChannelId } from "@/lib/platforms/creatorProfile";

/**
 * Live YouTube reads for Creator Finder, with the platform's API key. Nothing
 * here is stored: YouTube's developer policies allow API-key statistics to be
 * kept for 30 days at most, and a prospect card only needs them while it is
 * open. Only figures YouTube returns are passed on -- no averages or other
 * derived numbers (Developer Policies III.E.4).
 */

export class YouTubeQuotaError extends Error {
  constructor() {
    super("YouTube's daily allowance for this request is used up");
  }
}

const API = "https://www.googleapis.com/youtube/v3";

/** The fields read from YouTube's list responses; everything is checked before use. */
type YtItem = {
  id?: unknown;
  snippet?: { [field: string]: unknown; channelId?: unknown; thumbnails?: unknown };
  statistics?: { [field: string]: unknown };
  contentDetails?: { relatedPlaylists?: { uploads?: unknown }; videoId?: unknown };
};
type YtList = { items?: YtItem[] };

async function api(path: string, params: Record<string, string>, signal?: AbortSignal): Promise<YtList> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw new Error("no-credentials");
  const url = new URL(`${API}/${path}`);
  for (const [k, v] of Object.entries({ ...params, key })) url.searchParams.set(k, v);
  const res = await fetch(url, { cache: "no-store", signal });
  if (res.status === 403 || res.status === 429) {
    const body = await res.json().catch(() => null);
    const reason = body?.error?.errors?.[0]?.reason;
    if (res.status === 429 || reason === "quotaExceeded" || reason === "rateLimitExceeded") throw new YouTubeQuotaError();
    throw new Error(`${path} ${res.status}${reason ? ` ${reason}` : ""}`);
  }
  if (!res.ok) throw new Error(`${path} ${res.status}`);
  return res.json();
}

function count(value: unknown): number | undefined {
  const n = Number(value);
  return value !== undefined && value !== null && value !== "" && Number.isFinite(n) ? n : undefined;
}

export type YouTubeChannelCard = {
  channelId: string;
  handle: string | null;
  title: string;
  description: string | null;
  thumbnailUrl: string | null;
  country: string | null;
  /** Absent when the channel hides it, never 0. */
  subscribers?: number;
  videos?: number;
  recent: Array<{ id: string; title: string; publishedAt: string | null; views?: number }>;
};

function card(item: YtItem & { id: string }): Omit<YouTubeChannelCard, "recent"> {
  const snippet = item.snippet ?? {};
  const stats = item.statistics ?? {};
  const handle = typeof snippet.customUrl === "string" && snippet.customUrl ? snippet.customUrl.replace(/^@/, "").toLowerCase() : null;
  const subscribers = stats.hiddenSubscriberCount === true ? undefined : count(stats.subscriberCount);
  const videos = count(stats.videoCount);
  return {
    channelId: item.id,
    handle,
    title: typeof snippet.title === "string" ? snippet.title : handle ?? item.id,
    description: typeof snippet.description === "string" && snippet.description.trim() ? snippet.description : null,
    thumbnailUrl: channelThumbnail(snippet.thumbnails),
    country: typeof snippet.country === "string" ? snippet.country : null,
    ...(subscribers !== undefined ? { subscribers } : {}),
    ...(videos !== undefined ? { videos } : {}),
  };
}

export const RECENT_UPLOADS = 6;

/** One channel by @handle or UC id, with its latest uploads. Null when YouTube
 *  answers that there is no such channel. Three quota units. */
export async function readYouTubeChannel(handleOrId: string, signal?: AbortSignal): Promise<YouTubeChannelCard | null> {
  const ref = handleOrId.replace(/^@/, "");
  const ch = await api(
    "channels",
    { part: "snippet,statistics,contentDetails", ...(isYouTubeChannelId(ref) ? { id: ref } : { forHandle: `@${ref}` }) },
    signal,
  );
  const item = ch.items?.[0];
  if (!item || typeof item.id !== "string") return null;
  const base = card({ ...item, id: item.id });
  const uploads = item.contentDetails?.relatedPlaylists?.uploads;
  let recent: YouTubeChannelCard["recent"] = [];
  if (typeof uploads === "string") {
    try {
      const pl = await api("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: String(RECENT_UPLOADS) }, signal);
      const ids = (pl.items ?? []).map((i) => i.contentDetails?.videoId).filter((v): v is string => typeof v === "string" && !!v);
      if (ids.length) {
        const vids = await api("videos", { part: "snippet,statistics", id: ids.join(",") }, signal);
        recent = (vids.items ?? []).flatMap((v) => {
          if (typeof v.id !== "string") return [];
          const views = count(v.statistics?.viewCount);
          const title = v.snippet?.title;
          const publishedAt = v.snippet?.publishedAt;
          return {
            id: v.id,
            title: typeof title === "string" ? title : "",
            publishedAt: typeof publishedAt === "string" ? publishedAt : null,
            ...(views !== undefined ? { views } : {}),
          };
        });
      }
    } catch (e) {
      // An empty channel's uploads playlist answers 404; the card is still useful.
      if (e instanceof YouTubeQuotaError) throw e;
    }
  }
  return { ...base, recent };
}

export type YouTubeSearchHit = Omit<YouTubeChannelCard, "recent">;

/**
 * Channels matching a phrase, e.g. "phonk car edit". search.list is the
 * expensive call (it has its own small daily bucket), so one search returns up
 * to 25 channels and their statistics come from a single channels.list.
 */
export async function searchYouTubeChannels(
  query: string,
  opts: { regionCode?: string; relevanceLanguage?: string } = {},
  signal?: AbortSignal,
): Promise<YouTubeSearchHit[]> {
  const q = query.trim().slice(0, 100);
  if (!q) return [];
  const search = await api(
    "search",
    {
      part: "snippet",
      type: "channel",
      maxResults: "25",
      q,
      ...(opts.regionCode ? { regionCode: opts.regionCode } : {}),
      ...(opts.relevanceLanguage ? { relevanceLanguage: opts.relevanceLanguage } : {}),
    },
    signal,
  );
  /* A search hit's id is an object ({ kind, channelId }), unlike a channels.list item's. */
  const ids = (search.items ?? [])
    .map((i) => {
      const ref = i.id && typeof i.id === "object" ? (i.id as { channelId?: unknown }).channelId : undefined;
      const fromSnippet = i.snippet?.channelId;
      return typeof ref === "string" ? ref : typeof fromSnippet === "string" ? fromSnippet : null;
    })
    .filter(isYouTubeChannelId);
  if (!ids.length) return [];
  const unique = [...new Set(ids)];
  const ch = await api("channels", { part: "snippet,statistics", id: unique.join(",") }, signal);
  const byId = new Map<string, YtItem & { id: string }>();
  for (const i of ch.items ?? []) if (typeof i.id === "string") byId.set(i.id, { ...i, id: i.id });
  return unique.flatMap((id) => {
    const item = byId.get(id);
    return item ? [card(item)] : [];
  });
}
