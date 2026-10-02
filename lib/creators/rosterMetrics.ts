/**
 * The roster's Followers and Avg. views, decided once for the screen and the
 * spreadsheet export so the two cannot disagree (plan §13 A1).
 *
 * Server-side: it words a stored read failure with the platform readers' own
 * copy, which lives beside those readers and is not something a client bundle
 * should pull in. The decisions themselves are lib/creators/metricValue's.
 */
import { parseTrackerError, READ_FAILURE_COPY } from "@/lib/platforms/creatorProfile";
import { avgViewsValue, followersValue, type MetricValue } from "./metricValue";

/**
 * A stored failure in words, or null when there is none.
 *
 * Creator.trackerLastError and CreatorProfileLink.refreshError share one shape
 * -- "reason: detail", optionally a note after a newline -- so one parse reads
 * both.
 */
export function readFailureText(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const { reason } = parseTrackerError(stored);
  return READ_FAILURE_COPY[reason] ?? "The last read of this account failed.";
}

type ReadStamp = { refreshedAt?: Date | string | null; refreshError?: string | null };

export type RosterCreatorFacts = {
  followersCount: number | null | undefined;
  trackerLastAttemptAt?: Date | string | null;
  trackerLastError?: string | null;
  /**
   * The creator's primary account on the roster, when the roster tables exist.
   * Its refresh is what writes Creator.followersCount, so its stamp is the one
   * that explains a missing count.
   */
  primaryLink?: ReadStamp | null;
};

/** Followers (primary): the creator's own count, with the primary account's read as the evidence. */
export function rosterFollowers(f: RosterCreatorFacts): MetricValue {
  const link = f.primaryLink ?? null;
  return followersValue(f.followersCount, {
    readError: readFailureText(link?.refreshError ?? f.trackerLastError),
    attemptedAt: link?.refreshedAt ?? f.trackerLastAttemptAt ?? null,
  });
}

/** Avg. views as the roster shows it: measured from tracked posts, else the account's own page. */
export function rosterAvgViews(
  avgViews: number | null | undefined,
  trackedPosts: number | null | undefined,
  f: Omit<RosterCreatorFacts, "followersCount">,
): MetricValue {
  const link = f.primaryLink ?? null;
  return avgViewsValue(avgViews, {
    trackedPosts: trackedPosts ?? null,
    readError: readFailureText(link?.refreshError ?? f.trackerLastError),
    attemptedAt: link?.refreshedAt ?? f.trackerLastAttemptAt ?? null,
  });
}

/** One account's follower count, read off its own link. */
export function linkFollowers(link: ReadStamp & { followersCount?: number | null }): MetricValue {
  return followersValue(link.followersCount ?? null, {
    readError: readFailureText(link.refreshError),
    attemptedAt: link.refreshedAt ?? null,
  });
}
