import { graphGet, resolveIgUserId, shortcodeFromUrl } from "./instagram";

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
  return {
    username: normalizeUsername(username),
    ...(typeof bd.followers_count === "number" ? { followersCount: bd.followers_count } : {}),
    ...(typeof bd.media_count === "number" ? { mediaCount: bd.media_count } : {}),
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
): Promise<(IgPublicPost & { authorFollowers?: number }) | null> {
  const shortcode = shortcodeFromUrl(postUrl);
  const profile = await fetchInstagramProfile(username, token, signal);
  if (!profile) return null;
  if (!shortcode) return null;
  const post = profile.recentPosts.find(
    (p) => typeof p.permalink === "string" && p.permalink.includes(`/${shortcode}`),
  );
  if (!post) return null;
  return {
    ...post,
    ...(typeof profile.followersCount === "number" ? { authorFollowers: profile.followersCount } : {}),
  };
}
