import { db } from "@/lib/db";
import { rankTopPosts, type TopPost } from "@/lib/platforms/creatorProfile";

/**
 * Top Posts from the posts this workspace already tracks for a creator.
 *
 * The last rung of the ladder, and the only one that needs nothing from TikTok.
 * Above it sit the creator's own catalogue via the official Display API (needs
 * their consent) and the browser grid (refused from Vercel egress in every
 * configuration measured). When neither answers, this does — and for a creator
 * on a campaign it answers with real, already-refreshed numbers: the sync cron
 * keeps Post.viewsCount current, so these are the same figures the campaign
 * screens report.
 *
 * It is a DIFFERENT CLAIM, and the difference is the whole reason
 * Creator.topPostsSource exists. "Their best videos" and "their best videos in
 * your campaigns" are not the same statement, and a panel that silently showed
 * the second while implying the first would be a quieter version of the
 * mistake that reposts nearly caused. The UI reads the source and says which.
 *
 * Scope note: db.post has no orgId of its own, so the creator row is the tenant
 * boundary here — callers pass a creatorId already resolved under an org.
 */

/** Enough to rank meaningfully without dragging a creator's whole history. */
const CANDIDATE_LIMIT = 60;

export type CampaignTopPostsRead = {
  topPosts: TopPost[];
  avgViews: number;
  sampledPosts: number;
};

/**
 * @returns null when this workspace tracks no posts for the creator — "not
 *   measured", so the caller leaves stored posts and their source alone.
 */
export async function readTopPostsFromCampaigns(
  creatorId: string
): Promise<CampaignTopPostsRead | null> {
  const rows = await db.post.findMany({
    where: { creatorId },
    /* Ordered by views so the candidate window holds the posts that can
       actually win, rather than the most recent ones. */
    orderBy: { viewsCount: "desc" },
    take: CANDIDATE_LIMIT,
    select: {
      platformPostId: true,
      postUrl: true,
      caption: true,
      thumbnailUrl: true,
      viewsCount: true,
      likesCount: true,
      commentsCount: true,
      postedAt: true,
    },
  });

  if (rows.length === 0) return null;

  const posts: TopPost[] = rows.map((r) => ({
    postId: r.platformPostId,
    url: r.postUrl,
    caption: r.caption ?? null,
    coverUrl: r.thumbnailUrl ?? null,
    /* The columns are non-null Floats defaulting to 0, but 0 here means "never
       synced" as often as it means "no views", and a zero rendered as a real
       count reads as a dead post. Null is the honest value. */
    views: r.viewsCount > 0 ? Math.round(r.viewsCount) : null,
    likes: r.likesCount > 0 ? Math.round(r.likesCount) : null,
    comments: r.commentsCount > 0 ? Math.round(r.commentsCount) : null,
    postedAt: r.postedAt ? r.postedAt.toISOString() : null,
  }));

  const views = posts.map((p) => p.views).filter((v): v is number => typeof v === "number");

  return {
    topPosts: rankTopPosts(posts),
    avgViews: views.length ? views.reduce((a, b) => a + b, 0) / views.length : 0,
    sampledPosts: views.length,
  };
}
