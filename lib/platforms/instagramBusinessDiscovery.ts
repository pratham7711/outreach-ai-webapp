import { graphGet, resolveIgUserId, shortcodeFromUrl } from "./instagram";

export type IgPublicPost = {
  id: string;
  permalink: string | null;
  caption: string | null;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  postedAt: Date | null;
  thumbnailUrl: string | null;
};

export type IgPublicProfile = {
  username: string;
  followersCount: number;
  mediaCount: number;
  recentPosts: IgPublicPost[];
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
    viewsCount: typeof node.view_count === "number" ? node.view_count : 0,
    likesCount: typeof node.like_count === "number" ? node.like_count : 0,
    commentsCount: typeof node.comments_count === "number" ? node.comments_count : 0,
    postedAt: node.timestamp ? new Date(node.timestamp) : null,
    thumbnailUrl: node.thumbnail_url ?? node.media_url ?? null,
  };
}

export function parseBusinessDiscovery(data: any, username: string): IgPublicProfile | null {
  const bd = data?.business_discovery;
  if (!bd) return null;
  const nodes: DiscoveryMediaNode[] = bd.media?.data ?? [];
  return {
    username: normalizeUsername(username),
    followersCount: typeof bd.followers_count === "number" ? bd.followers_count : 0,
    mediaCount: typeof bd.media_count === "number" ? bd.media_count : 0,
    recentPosts: nodes.map(mapMedia),
  };
}

export async function fetchInstagramProfile(
  username: string,
  token: string,
  signal?: AbortSignal,
): Promise<IgPublicProfile | null> {
  const handle = normalizeUsername(username);
  if (!handle) return null;

  const igUserId = await resolveIgUserId(token, signal);
  if (!igUserId) return null;

  const mediaFields =
    "media.limit(100){id,caption,view_count,like_count,comments_count,timestamp,permalink,media_url,thumbnail_url}";
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

export async function fetchInstagramPublicPostMetrics(
  username: string,
  postUrl: string,
  token: string,
  signal?: AbortSignal,
): Promise<IgPublicPost | null> {
  const shortcode = shortcodeFromUrl(postUrl);
  const profile = await fetchInstagramProfile(username, token, signal);
  if (!profile) return null;
  if (!shortcode) return null;
  return (
    profile.recentPosts.find(
      (p) => typeof p.permalink === "string" && p.permalink.includes(`/${shortcode}`),
    ) ?? null
  );
}
