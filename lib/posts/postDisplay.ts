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
