import { fetchTikTokVideos } from "./tiktokDisplay";
import { getTikTokTokenForCreator } from "./tiktokToken";
import { rankTopPosts, type TopPost } from "./creatorProfile";

/**
 * TikTok Top Posts through the official Display API — the sanctioned path, and
 * the only one that actually works.
 *
 * Everything else was measured and refused (2026-09-01): `/api/post/item_list/`
 * answers 200 with a zero-byte body to every browser tried from Vercel egress,
 * headed google-chrome under Xvfb included, and the server-rendered profile
 * HTML carries no post data at all (0 video ids, 0 playCount — `user-detail` is
 * 2.4KB of follower stats and nothing else). Scraping the grid is not a
 * solved problem here.
 *
 * `video.list` is. It returns the creator's own videos with view, like and
 * comment counts and a cover image, needs no browser, and costs one HTTPS
 * request. The catch is consent: it only works for a creator who has connected
 * their TikTok through the creator portal, so this covers connected creators
 * and returns null — not an error — for the rest. That is the honest shape of
 * the feature: a creator who authorised us gets real Top Posts; one who did not
 * gets an empty panel rather than someone else's videos.
 *
 * (The trap that produced a wrong answer once: the profile page's
 * `/api/repost/item_list/` DOES return 30 items. They are the creator's
 * reposts, authored by other people.)
 */

export type OfficialTopPostsRead = {
  topPosts: TopPost[];
  /** Mean views across every video returned, not just the ranked ones. */
  avgViews: number;
  sampledPosts: number;
};

/**
 * @returns null when the creator has no usable TikTok connection (never
 *   connected, or the authorisation expired) — the caller should treat that as
 *   "not measured" and leave stored posts alone.
 */
export async function readTikTokTopPostsOfficial(
  creatorId: string,
  orgId: string,
  handle: string
): Promise<OfficialTopPostsRead | null> {
  const accessToken = await getTikTokTokenForCreator(creatorId, orgId);
  if (!accessToken) return null;

  const videos = await fetchTikTokVideos(accessToken);
  /* null is the module's "authorisation is gone" signal; an empty array is a
     real answer from a creator who has posted nothing. Neither is an error. */
  if (videos === null) return null;

  const clean = handle.replace(/^@/, "").trim();
  const posts: TopPost[] = videos.map((v) => ({
    postId: v.id,
    /* share_url is the canonical link when TikTok gives one; the handle form is
       a correct fallback and keeps the row clickable either way. */
    url: v.shareUrl ?? `https://www.tiktok.com/@${clean}/video/${v.id}`,
    caption: v.description || v.title || null,
    coverUrl: v.coverImageUrl ?? null,
    views: Number.isFinite(v.viewsCount) ? v.viewsCount : null,
    likes: Number.isFinite(v.likesCount) ? v.likesCount : null,
    comments: Number.isFinite(v.commentsCount) ? v.commentsCount : null,
    postedAt: v.postedAt ?? null,
  }));

  const views = posts.map((p) => p.views).filter((v): v is number => typeof v === "number");

  return {
    topPosts: rankTopPosts(posts),
    avgViews: views.length ? views.reduce((a, b) => a + b, 0) / views.length : 0,
    sampledPosts: views.length,
  };
}
