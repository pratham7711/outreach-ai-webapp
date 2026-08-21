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
 * ourselves, so a 0 with no sync timestamp is unknown and renders as an em dash.
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

/** Tooltip text for a dash that means "never fetched", not "zero". */
export const NEVER_MEASURED = "Not collected yet — this post was imported with view counts only";
