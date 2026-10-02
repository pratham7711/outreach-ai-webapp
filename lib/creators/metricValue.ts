/**
 * A creator's figure, or the reason we do not have one (plan §13 A1).
 *
 * "Unknown" is never shown as 0. Creator.followersCount and averageViews are
 * Float @default(0), and so is every CreatorSocialAccount counter, so a creator
 * nobody has read and a creator with no audience store the same number. The
 * schema stays as it is -- a column added to an existing model breaks every
 * query on it in any database that has not had the DDL yet (plan F6) -- so the
 * rule is applied where figures are shown and exported: a figure is either a
 * number we measured, or `{ unknown: true, reason }`, and the reason is built
 * from what each screen already holds about the read (when it was tried, why it
 * failed, how many readings and posts there are).
 *
 * One module, so the roster, the creator page, Trackers, the list page and the
 * spreadsheet exports cannot disagree about what counts as unknown, and so each
 * renders the same "—" with the same kind of reason.
 *
 * Client-safe on purpose: no database, no platform readers. Callers that hold a
 * worded failure (the trackers route, the server-rendered roster) pass it in as
 * `readError`; a client that only has the stored string passes `lastError` and
 * gets a plainer sentence.
 */
import { UNKNOWN, formatDateAbs, formatFull } from "@/lib/format";
import {
  fieldMetricValue,
  metricValue as postMetricValue,
  postEngagementPercent,
  rollupEngagement,
  type MetricField,
} from "@/lib/metricDisplay";
import { followerCount } from "@/lib/trackers/creatorMetrics";

export type UnknownMetric = { unknown: true; reason: string };
export type MetricValue = number | UnknownMetric;

export function unknownMetric(reason: string): UnknownMetric {
  return { unknown: true, reason };
}

export function isUnknownMetric(value: MetricValue): value is UnknownMetric {
  return typeof value !== "number";
}

/** The number, or null -- for sorting and filtering code that already speaks null. */
export function knownMetric(value: MetricValue): number | null {
  return isUnknownMetric(value) ? null : value;
}

/** What a screen knows about the last attempt to read an account. Every field is optional. */
export type ReadEvidence = {
  /** When a read was last tried, whether or not it worked. null means never;
   *  leave it out when the screen does not know. */
  attemptedAt?: string | Date | null;
  /** Why the last attempt produced nothing, already worded for a reader. */
  readError?: string | null;
  /** The same, as stored, for a caller that has no worded form to hand. */
  lastError?: string | null;
  /** Successful readings on record (tracker snapshots). */
  readings?: number | null;
};

/**
 * Why a read-off-the-profile figure is missing, most specific first.
 *
 * A failure beats everything because it is the one the operator can act on --
 * a renamed handle, a personal Instagram. Then "read, but no figure", which is
 * a platform that answered without it. Then "never read", which only time fixes.
 */
function readReason(e: ReadEvidence, what: string, storedZero: boolean): string {
  if (e.readError) return e.readError;
  if (e.lastError) return `The last read of this account failed, so there is no ${what}.`;
  if ((e.readings ?? 0) > 0) return `The last reading did not include a ${what}.`;
  if (e.attemptedAt) {
    const when = formatDateAbs(e.attemptedAt);
    return when === UNKNOWN
      ? `The last read did not return a ${what}.`
      : `The last read (${when}) did not return a ${what}.`;
  }
  /* null is the caller saying "never tried"; undefined is a caller that holds
     no read history at all, which cannot claim either way. */
  if (e.attemptedAt === null) {
    return storedZero
      ? `Not read from the platform yet. The 0 on file is a placeholder, not a ${what}.`
      : `Not read from the platform yet.`;
  }
  return `No ${what} on record yet.`;
}

/**
 * Followers: a positive count, or why there is none.
 *
 * Zero is unknown here, exactly as lib/trackers/creatorMetrics' followerCount
 * already decides. A genuine zero is hidden by that rule; it is the cheaper
 * mistake, because a false zero tells a brand an account has no audience.
 */
export function followersValue(value: number | null | undefined, evidence: ReadEvidence = {}): MetricValue {
  const n = followerCount(value);
  if (n !== null) return n;
  return unknownMetric(readReason(evidence, "follower count", value === 0));
}

/** What a screen knows about the posts an average-views figure would come from. */
export type ViewsEvidence = ReadEvidence & {
  /** Posts this workspace tracks for the creator. */
  trackedPosts?: number | null;
};

/**
 * Avg. views: a positive mean, or why there is none.
 *
 * The roster's figure is measured from tracked posts with a view count and
 * falls back to what the account's own page last said. Neither existing is
 * "no posts with views", which is a different sentence from "never read".
 */
export function avgViewsValue(value: number | null | undefined, evidence: ViewsEvidence = {}): MetricValue {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  /* Posts first when the caller counts them: a creator with tracked posts and
     no figure is a statement about those posts, whatever the profile read did. */
  const posts = evidence.trackedPosts ?? null;
  if (posts !== null && posts > 0) {
    return unknownMetric(
      `${posts === 1 ? "Their one tracked post has no view count yet" : `None of their ${formatFull(posts)} tracked posts has a view count yet`}, and no profile read has sampled their posts.`,
    );
  }
  if (evidence.readError) return unknownMetric(evidence.readError);
  if (posts === 0 && !evidence.lastError) {
    return unknownMetric("No tracked posts with views, and no profile read has sampled their posts yet.");
  }
  return unknownMetric(readReason(evidence, "view average", value === 0));
}

/** A post as the engagement figures need it. */
export type EngagementPost = {
  viewsCount?: number | null;
  likesCount?: number | null;
  commentsCount?: number | null;
  sharesCount?: number | null;
  savesCount?: number | null;
  lastSyncedAt?: string | Date | null;
  platformMetrics?: unknown;
};

/** Whether a post's counters were ever read -- lib/metricDisplay's rule, not a second one. */
function postWasMeasured(p: EngagementPost): boolean {
  return postMetricValue(p.likesCount, p.lastSyncedAt) !== null;
}

/** A post as its counters need it: the stamps lib/metricDisplay judges them by. */
export type CounterPost = {
  lastSyncedAt?: string | Date | null;
  platformMetrics?: unknown;
};

/**
 * One of a post's counters, or why it is missing -- lib/metricDisplay's
 * per-field rule, given a reason. A counter the platform never reported (an
 * Instagram post's shares) and a post nobody has read say different things.
 */
export function postCounterValue(value: number | null | undefined, post: CounterPost, field: MetricField): MetricValue {
  const v = fieldMetricValue(value, post.lastSyncedAt, post.platformMetrics, field);
  if (v !== null) return v;
  return unknownMetric(
    post.lastSyncedAt
      ? `The platform did not report ${field} for this post.`
      : "This post's figures have not been read from the platform yet.",
  );
}

/**
 * One post's engagement rate, in percent, or why it has none.
 *
 * From the counters, never the stored engagementRate column -- see
 * postEngagementPercent for why that column cannot be printed.
 */
export function postEngagementValue(p: EngagementPost): MetricValue {
  const rate = postEngagementPercent(p);
  if (rate !== null) return rate;
  if (!postWasMeasured(p)) return unknownMetric("Likes and comments have not been read for this post yet.");
  return unknownMetric("The platform did not report both views and likes for this post, so it has no rate.");
}

/**
 * A creator's engagement over their posts, in percent.
 *
 * The campaign rate's definition -- engagements over views, summed across the
 * posts whose views and likes were both measured -- so the creator page and a
 * campaign report agree about the same posts. Unread posts are left out: their
 * zeroes were never earned, and counting them is how an imported creator's real
 * rate was divided down towards 0.
 */
export function creatorEngagementValue(posts: readonly EngagementPost[]): MetricValue {
  if (posts.length === 0) return unknownMetric("No posts are tracked for this creator yet.");
  const measured = posts.filter((p) => postEngagementPercent(p) !== null);
  if (measured.length === 0) {
    return unknownMetric(
      posts.length === 1
        ? "Their one post has not had its views and likes read yet."
        : `None of their ${formatFull(posts.length)} posts has had its views and likes read yet.`,
    );
  }
  const { rate } = rollupEngagement(measured);
  return rate === null ? unknownMetric("Their measured posts have no views.") : rate * 100;
}

/** The figure as text: the number formatted, or "—". */
export function metricText(value: MetricValue, format: (n: number) => string = formatFull): string {
  return isUnknownMetric(value) ? UNKNOWN : format(value);
}

/** The reason, for a tooltip; undefined for a known figure. */
export function metricReason(value: MetricValue): string | undefined {
  return isUnknownMetric(value) ? value.reason : undefined;
}

/**
 * The spreadsheet cell: the number, or "—".
 *
 * Never an empty cell. A blank in an export reads as "nothing there", which is
 * the zero this module exists to stop claiming; the reason travels in the
 * row's notes column (see unknownNotes).
 */
export function metricExportCell(value: MetricValue): number | string {
  return isUnknownMetric(value) ? UNKNOWN : value;
}

/**
 * An export row's notes: "TikTok followers, Followers (primary): Not read from
 * the platform yet. Avg views: …". Figures missing for the same reason share
 * it, so a row does not repeat one sentence per column. "" when all are known.
 */
export function unknownNotes(entries: readonly (readonly [label: string, value: MetricValue])[]): string {
  const byReason = new Map<string, string[]>();
  for (const [label, v] of entries) {
    if (!isUnknownMetric(v)) continue;
    byReason.set(v.reason, [...(byReason.get(v.reason) ?? []), label]);
  }
  return [...byReason.entries()].map(([reason, labels]) => `${labels.join(", ")}: ${reason}`).join(" ");
}

/** Highest first, unknowns last however the rest compare. */
export function compareMetricDesc(a: MetricValue, b: MetricValue): number {
  const av = knownMetric(a);
  const bv = knownMetric(b);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return bv - av;
}
