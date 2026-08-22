import { db } from "@/lib/db";
import { fetchPostMetrics, hasMetricCounts, type PostMetrics } from "@/lib/platforms/fetchPostMetrics";
import { getInstagramAccountForCreator } from "@/lib/platforms/instagramToken";
import { getTikTokTokenForCreator } from "@/lib/platforms/tiktokToken";

/**
 * Refresh one post's metrics from its platform.
 *
 * Lives here rather than in the route because two callers drive it: the per-post
 * "Sync Now" button and the campaign-wide Refresh, which loops it. The cron in
 * app/api/cron/sync-posts deliberately keeps its own copy -- it batches YouTube
 * ids, spends per-platform budgets and applies backoff, none of which an
 * on-demand refresh wants.
 *
 * The rule that matters: lastSyncedAt is stamped only when counts actually came
 * back. Every counter is a non-nullable Float defaulting to 0, so lastSyncedAt
 * is the only thing separating "this post got no likes" from "nobody has
 * looked" (see lib/metricDisplay). Stamping it on a fetch that returned nothing
 * -- which is what every TikTok fetch does from a network where TikTok is
 * blocked -- silently converts a screenful of unknowns into measured zeros, and
 * no later sync can tell them apart again.
 */

export const SYNC_POST_INCLUDE = {
  creator: { select: { id: true, name: true, handle: true, avatarUrl: true } },
  snapshots: { orderBy: { recordedAt: "desc" as const }, take: 50 },
};

export type SyncPostOutcome =
  /** Counts came back and were written, with a snapshot for the timeseries. */
  | { status: "measured"; post: Record<string, unknown> }
  /** The platform answered but carried no counts; only media/caption touched. */
  | { status: "no-metrics"; post: Record<string, unknown> }
  /** Nothing usable at all -- an unrecognised URL, or the platform unreachable. */
  | { status: "unfetchable" };

type SyncablePost = {
  id: string;
  platform: string;
  creatorId: string;
  postUrl: string;
  thumbnailUrl: string | null;
  caption: string | null;
};

/**
 * Write metrics that were already fetched.
 *
 * Split out from syncPost because fetching and writing sometimes cannot happen
 * on the same network. TikTok is unreachable from India and our database is
 * unreachable through the VPN that fixes that -- port 5432 gets reset while 443
 * passes -- so the dev filler fetches with the tunnel up and writes with it
 * down. Both paths land here, so the offline writer cannot drift from the live
 * one on which columns it sets.
 */
export async function applyPostMetrics(
  post: SyncablePost,
  metrics: PostMetrics,
): Promise<SyncPostOutcome> {
  if (!hasMetricCounts(metrics)) {
    // Worth keeping if the fetch produced one: a thumbnail with no counts is
    // still better than an empty card. No lastSyncedAt -- see above.
    const updated = await db.post.update({
      where: { id: post.id },
      data: {
        thumbnailUrl: metrics.thumbnailUrl ?? post.thumbnailUrl,
        caption: metrics.caption ?? post.caption,
      },
      include: SYNC_POST_INCLUDE,
    });
    return { status: "no-metrics", post: updated as unknown as Record<string, unknown> };
  }

  const views = metrics.viewsCount ?? 0;
  const likes = metrics.likesCount ?? 0;
  const comments = metrics.commentsCount ?? 0;
  const shares = metrics.sharesCount ?? 0;
  const engagementRate =
    metrics.engagementRate ?? (views > 0 ? ((likes + comments) / views) * 100 : 0);

  const [updated] = await db.$transaction([
    db.post.update({
      where: { id: post.id },
      data: {
        thumbnailUrl: metrics.thumbnailUrl ?? post.thumbnailUrl,
        caption: metrics.caption ?? post.caption,
        lastSyncedAt: new Date(),
        viewsCount: views,
        likesCount: likes,
        commentsCount: comments,
        sharesCount: shares,
        engagementRate,
      },
      include: SYNC_POST_INCLUDE,
    }),
    db.postMetricSnapshot.create({
      data: {
        postId: post.id,
        viewsCount: views,
        likesCount: likes,
        commentsCount: comments,
        sharesCount: shares,
        engagementRate,
        syncSource: "api",
      },
    }),
  ]);

  return { status: "measured", post: updated as unknown as Record<string, unknown> };
}

export async function syncPost(post: SyncablePost, orgId: string): Promise<SyncPostOutcome> {
  const instagram =
    post.platform === "INSTAGRAM"
      ? await getInstagramAccountForCreator(post.creatorId, orgId)
      : undefined;
  const tiktokToken =
    post.platform === "TIKTOK" ? await getTikTokTokenForCreator(post.creatorId, orgId) : undefined;

  const metrics = await fetchPostMetrics(post.postUrl, {
    instagramToken: instagram?.token,
    instagramHandle: instagram?.handle,
    tiktokToken,
  });
  if (!metrics) return { status: "unfetchable" };

  return applyPostMetrics(post, metrics);
}
