import { graphGet } from "./instagram";

/**
 * The public profile and recent posts of another Instagram professional
 * account, read through Business Discovery on behalf of the agency's OWN
 * connected Instagram account (Settings > Integrations).
 *
 * This is the screen-facing read behind `instagram_manage_insights`' "discover
 * and read the profile info and media of other business profiles". It is
 * deliberately separate from the background readers in
 * instagramBusinessDiscovery.ts: those may fall back to other credentials to
 * keep a sweep going, and this one never does. The caller passes the agency's
 * own token and IG user id, and when the agency has not connected an account
 * there is no read at all. Nothing here is stored.
 */

export const PROFILE_MEDIA_LIMIT = 12;

export type DiscoveryMedia = {
  id: string;
  caption: string | null;
  mediaType: string | null;
  permalink: string | null;
  thumbnailUrl: string | null;
  postedAt: string | null;
  /* Absent, not zero, when Instagram leaves them out: a still image has no
     view count and a creator can hide like counts. */
  views?: number;
  likes?: number;
  comments?: number;
};

export type DiscoveryProfileView = {
  username: string;
  name: string | null;
  biography: string | null;
  website: string | null;
  profilePictureUrl: string | null;
  followers?: number;
  following?: number;
  posts?: number;
  media: DiscoveryMedia[];
};

const PROFILE_FIELDS = "id,username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count";
const MEDIA_FIELDS = "id,caption,media_type,permalink,media_url,thumbnail_url,timestamp,view_count,like_count,comments_count";

export function normalizeHandle(input: string): string {
  return input.trim().replace(/^@/, "").replace(/\/+$/, "").toLowerCase();
}

/** Instagram usernames: letters, digits, periods and underscores, up to 30. */
export function isInstagramUsername(handle: string): boolean {
  return /^[a-z0-9._]{1,30}$/.test(handle);
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function parseDiscoveryProfile(data: unknown, handle: string): DiscoveryProfileView | null {
  const bd = (data as { business_discovery?: Record<string, unknown> } | null)?.business_discovery;
  if (!bd) return null;
  const nodes = ((bd.media as { data?: unknown[] } | undefined)?.data ?? []) as Array<Record<string, unknown>>;
  const followers = count(bd.followers_count);
  const following = count(bd.follows_count);
  const posts = count(bd.media_count);
  return {
    username: text(bd.username) ?? handle,
    name: text(bd.name),
    biography: text(bd.biography),
    website: text(bd.website),
    profilePictureUrl: text(bd.profile_picture_url),
    ...(followers !== undefined ? { followers } : {}),
    ...(following !== undefined ? { following } : {}),
    ...(posts !== undefined ? { posts } : {}),
    media: nodes
      .filter((m) => typeof m.id === "string")
      .map((m) => {
        const views = count(m.view_count);
        const likes = count(m.like_count);
        const comments = count(m.comments_count);
        return {
          id: m.id as string,
          caption: text(m.caption),
          mediaType: text(m.media_type),
          permalink: text(m.permalink),
          thumbnailUrl: text(m.thumbnail_url) ?? text(m.media_url),
          postedAt: text(m.timestamp),
          ...(views !== undefined ? { views } : {}),
          ...(likes !== undefined ? { likes } : {}),
          ...(comments !== undefined ? { comments } : {}),
        };
      }),
  };
}

/**
 * One Business Discovery read. Throws InstagramAuthError when the agency's
 * token is refused and InstagramNoSuchAccountError when the handle is not a
 * public professional account; null for any other failure.
 */
export async function readDiscoveryProfile(
  handle: string,
  agency: { token: string; igUserId: string },
  signal?: AbortSignal,
): Promise<DiscoveryProfileView | null> {
  const username = normalizeHandle(handle);
  if (!isInstagramUsername(username)) return null;
  const data = await graphGet(
    agency.igUserId,
    {
      fields: `business_discovery.username(${username}){${PROFILE_FIELDS},media.limit(${PROFILE_MEDIA_LIMIT}){${MEDIA_FIELDS}}}`,
      access_token: agency.token,
    },
    signal,
    { noSuchAccountThrows: true },
  );
  return parseDiscoveryProfile(data, username);
}
