/**
 * Telling "zero" apart from "nobody asked".
 *
 * The engagement counters are non-nullable Floats defaulting to 0, so a post
 * that was never fetched is indistinguishable from one that genuinely got no
 * likes -- both read 0. Right now 18,602 of 18,708 posts are in the first case
 * (imported from CreatorCore, which only carried view counts) and exactly 0 are
 * in the second. Printing "0" on all of them states a fact we never measured.
 *
 * lastSyncedAt is the tiebreak: it is set only when we fetched the post
 * ourselves, so a 0 with no sync timestamp is unknown. Callers drop the cell,
 * column or tile entirely rather than printing a placeholder for it.
 */

/** Sentinel for "we never measured this", so callers can format it their own way. */
export const UNKNOWN = null;

export function metricValue(
  value: number | null | undefined,
  lastSyncedAt: string | Date | null | undefined
): number | null {
  if (value === null || value === undefined) return UNKNOWN;
  if (value > 0) return value;
  // A zero we actually observed is worth showing; one we never looked up is not.
  return lastSyncedAt ? 0 : UNKNOWN;
}

/**
 * For counters nothing in this repo ever writes: saves and downloads.
 *
 * PostMetrics carries views, likes, comments and shares and nothing else -- no
 * fetcher here has ever populated savesCount or downloadsCount, and only the
 * CreatorCore import did. So a 0 in those two columns is the column default, not
 * a reading, and lastSyncedAt cannot rescue it: a TikTok sync legitimately
 * stamps that timestamp while leaving both untouched, which made metricValue
 * report "Total Saves 0" on a campaign whose saves we never asked for. The same
 * argument already applies to reachCount -- see lib/reports/shareVisibility.
 *
 * A genuine zero is hidden by this rule. That is the cheaper mistake: omitting a
 * true zero costs a tile, while asserting a false one tells a brand its campaign
 * earned no saves.
 */
export function unwrittenMetricValue(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return UNKNOWN;
  return value > 0 ? value : UNKNOWN;
}

/**
 * Engagement rate is derived from the same unmeasured counters, so it inherits
 * their provenance rather than confidently reporting 0.00%.
 */
export function engagementRateValue(
  likes: number | null | undefined,
  comments: number | null | undefined,
  views: number | null | undefined,
  lastSyncedAt: string | Date | null | undefined
): number | null {
  const l = metricValue(likes, lastSyncedAt);
  const c = metricValue(comments, lastSyncedAt);
  if (l === UNKNOWN && c === UNKNOWN) return UNKNOWN;
  if (!views || views <= 0) return UNKNOWN;
  return (((l ?? 0) + (c ?? 0)) / views) * 100;
}

export type MeasurablePost = {
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  downloadsCount: number;
  lastSyncedAt: string | Date | null;
};

/**
 * The Posts-tab summary row. Views are always real -- every import carried them.
 * Every other total stays UNKNOWN until at least one post in scope was actually
 * measured, because summing unfetched zeroes would invent a figure.
 *
 * Two rates, as the reference has: `avgPostRate` is the mean of the per-post
 * rates, `campaignRate` is total engagement over total views. Both divide by
 * measured views only, so an unfetched post cannot dilute them.
 */
export function summarizePostMetrics(posts: readonly MeasurablePost[]) {
  const measured = posts.filter((p) => metricValue(p.likesCount, p.lastSyncedAt) !== UNKNOWN);
  const sum = (pick: (p: MeasurablePost) => number) =>
    measured.length === 0 ? UNKNOWN : measured.reduce((acc, p) => acc + (pick(p) || 0), 0);

  const likes = sum((p) => p.likesCount);
  const comments = sum((p) => p.commentsCount);
  const shares = sum((p) => p.sharesCount);
  const saves = sum((p) => p.savesCount);
  const downloads = sum((p) => p.downloadsCount);
  /* Five terms, matching CreatorCore's own `engagement` field rather than
     guessing: audited over 9,372 of their statistic-post records, 8,767 equal
     likes+comments+shares+downloads (no saves on the row) and 804 equal that
     plus saves, with 0 matching neither. Their engagementRate is exactly this
     over views in every row. */
  const engagement =
    likes === UNKNOWN
      ? UNKNOWN
      : likes + (comments ?? 0) + (shares ?? 0) + (downloads ?? 0) + (saves ?? 0);

  const perPostRates = measured
    .map((p) => engagementRateValue(p.likesCount, p.commentsCount, p.viewsCount, p.lastSyncedAt))
    .filter((r): r is number => r !== UNKNOWN);
  const avgPostRate =
    perPostRates.length === 0
      ? UNKNOWN
      : perPostRates.reduce((a, b) => a + b, 0) / perPostRates.length;

  const measuredViews = measured.reduce((acc, p) => acc + (p.viewsCount || 0), 0);
  const campaignRate =
    engagement !== UNKNOWN && measuredViews > 0 ? (engagement / measuredViews) * 100 : UNKNOWN;

  return {
    posts: posts.length,
    views: posts.reduce((acc, p) => acc + (p.viewsCount || 0), 0),
    avgPostRate,
    campaignRate,
    engagement,
    likes,
    comments,
    shares,
    saves,
  };
}

