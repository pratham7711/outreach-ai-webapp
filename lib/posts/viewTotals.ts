import { fieldMetricValue } from "@/lib/metricDisplay";
import { dataAsOf } from "@/lib/dataAge";
import { postMeasuredAt } from "@/lib/posts/postStatus";

/**
 * A views total over a set of posts, with what it covers and when it was read.
 *
 * The song screens summed viewsCount straight off the rows, so a song whose
 * posts nobody had read -- Instagram photos, an import that carried no counts --
 * showed "0 views", and a song read this morning looked no different from one
 * read last month. This adds only the views a post actually has (the same
 * per-field rule as every other screen), says how many posts that covers, and
 * carries the newest reading behind it for the "as of" line.
 *
 * `views` is null, not 0, when no post has a view count we hold. Client-safe:
 * no database.
 */
export type ViewTotalsPost = {
  viewsCount: number | null;
  lastSyncedAt?: string | Date | null;
  lastFreshAt?: string | Date | null;
  platformMetrics?: unknown;
};

export type ViewTotals = {
  /** Sum of the known view counts; null when none is known. */
  views: number | null;
  /** Posts whose view count is known. */
  viewsKnown: number;
  /** Posts the total is over. */
  posts: number;
  /** The newest reading among the posts (ISO), or null when none was read or imported with a time. */
  asOf: string | null;
};

export function viewTotals(posts: readonly ViewTotalsPost[]): ViewTotals {
  let views: number | null = null;
  let viewsKnown = 0;
  for (const p of posts) {
    const v = fieldMetricValue(p.viewsCount, p.lastSyncedAt, p.platformMetrics, "views");
    if (v === null) continue;
    views = (views ?? 0) + v;
    viewsKnown += 1;
  }
  const asOf = dataAsOf(posts.map((p) => postMeasuredAt(p).at));
  return { views, viewsKnown, posts: posts.length, asOf: asOf ? asOf.toISOString() : null };
}
