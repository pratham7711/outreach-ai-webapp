import { computeEngagementRate } from "@/lib/metrics";
import { timeAgo } from "@/lib/format";

/**
 * The small pure helpers the posts tab and the post card both need.
 *
 * They used to live inside PostsTab as module-local functions, which was fine
 * while the card was inline JSX in that file. It is its own memoised component
 * now, and a component importing back out of the page that renders it is an
 * import cycle -- so the shared parts moved down here instead.
 */

export const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING_REVIEW: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

/** Never-synced is a fact worth stating; timeAgo's "Recently" fallback would claim the opposite. */
export function formatSince(iso: string | null): string {
  return iso ? timeAgo(iso) : "Never";
}

type EngagementCounts = {
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
};

export function engRatePct(post: EngagementCounts): number | null {
  const r = computeEngagementRate({
    views: post.viewsCount,
    likes: post.likesCount,
    comments: post.commentsCount,
    shares: post.sharesCount,
    saves: post.savesCount,
  });
  return r === null ? null : r * 100;
}

/**
 * What a tracking control says when you hover it.
 *
 * Tracking is the one thing on this page that keeps working after you leave
 * it, so the label has to carry the two facts that follow from that: whether
 * it is on, and when it stops on its own. "Tracking" alone reads as permanent,
 * which no post tracker is.
 */
export function trackingLabel(enabled: boolean, expiresAt: string | null): string {
  if (!enabled) return "Not tracked — track this post to record a time series";
  if (!expiresAt) return "Tracking";
  const stops = new Date(expiresAt);
  if (Number.isNaN(stops.getTime())) return "Tracking";
  const days = Math.max(0, Math.ceil((stops.getTime() - Date.now()) / 86_400_000));
  return `Tracking — stops in ${days} day${days === 1 ? "" : "s"}, on ${stops.toLocaleDateString()}`;
}
