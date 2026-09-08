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

import { sumEngagements } from "@/lib/metrics/costs";

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
 * Per-field provenance, for the case lastSyncedAt cannot describe.
 *
 * lastSyncedAt is one flag for a whole row, but which counters a fetch comes back
 * with varies by platform and even by post: TikTok's public payload carries
 * views, likes, comments and shares; Instagram's carries views and comments, and
 * likes only sometimes. The write path used to coerce every absent field with
 * `?? 0` and then stamp the timestamp, so three Instagram posts on the reference
 * campaign reported "0 likes, 0 shares" -- and CreatorCore's own report, looking
 * at the same three posts, shows no likes row and no shares row at all. Omitting
 * what the platform never said is the parity behaviour, not a divergence from it.
 *
 * applyPostMetrics now records the fields a fetch actually delivered, under a
 * namespaced key in the existing platformMetrics bag (alongside the importer's
 * `__cc` and `__stat`), so no column had to be added for this.
 *
 * A post with no record -- everything imported from CreatorCore, and everything
 * synced before this existed -- falls through to the row-level rule, which is
 * exactly the old behaviour.
 */
export const MEASURED_FIELDS_KEY = "__measured";

/**
 * Where the last unsuccessful read's cause is kept, on the post itself.
 *
 * Lives in the platformMetrics bag rather than a column because production was
 * built with `db push` and has no migration table, so adding one is a schema
 * change nobody can review as a diff. The bag is already the home of
 * __measured, already merged rather than replaced, and already read here.
 *
 * It exists because a reason that lives only in a log line cannot be asked a
 * question later. "41 of 62 updated" was unanswerable an hour after the run:
 * the aggregate sat on CampaignRefreshRun, the per-source detail had scrolled
 * out of the platform logs, and the posts themselves recorded nothing at all --
 * so which 21, and why, was gone. Written on every read that comes back
 * without counts and cleared by the next one that succeeds, so it always
 * describes the post's current state and never an old one.
 */
export const LAST_FETCH_KEY = "__lastFetch";

export type LastFetchNote = {
  /** The FetchReason slug; the wording for it lives in lib/refreshSummary. */
  reason: string;
  /** ISO timestamp, so "still failing" and "failed once yesterday" differ. */
  at: string;
  /** Which caller saw it: cron, api, or a named backfill. */
  via: string;
};

/** The stored cause, or null when the last read succeeded. */
export function lastFetchNote(platformMetrics: unknown): LastFetchNote | null {
  if (typeof platformMetrics !== "object" || platformMetrics === null) return null;
  const raw = (platformMetrics as Record<string, unknown>)[LAST_FETCH_KEY];
  if (typeof raw !== "object" || raw === null) return null;
  const note = raw as Record<string, unknown>;
  if (typeof note.reason !== "string") return null;
  return {
    reason: note.reason,
    at: typeof note.at === "string" ? note.at : "",
    via: typeof note.via === "string" ? note.via : "",
  };
}

export type MetricField = "views" | "likes" | "comments" | "shares" | "saves" | "downloads";

export function measuredFields(platformMetrics: unknown): MetricField[] | null {
  if (!platformMetrics || typeof platformMetrics !== "object") return null;
  const raw = (platformMetrics as Record<string, unknown>)[MEASURED_FIELDS_KEY];
  return Array.isArray(raw) ? (raw.filter((f) => typeof f === "string") as MetricField[]) : null;
}

export function fieldMetricValue(
  value: number | null | undefined,
  lastSyncedAt: string | Date | null | undefined,
  platformMetrics: unknown,
  field: MetricField
): number | null {
  // A value we hold is a value we hold, whatever its provenance -- the importer
  // wrote real saves counts with no sync timestamp and no measured list.
  if (typeof value === "number" && value > 0) return value;
  const fields = measuredFields(platformMetrics);
  if (fields) return fields.includes(field) ? metricValue(value, lastSyncedAt) : UNKNOWN;
  return metricValue(value, lastSyncedAt);
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

/**
 * THE engagement rate. One definition, one implementation, every caller.
 *
 * It was three. The campaign Overview tile took an unweighted mean of
 * Post.engagementRate across every post including the ones nobody ever
 * measured, so an imported campaign's real 6% was divided by seventeen zeroes
 * and shown as 0.4%. The Posts tab divided a five-term engagement (with
 * downloads) by measured views. The Performance tab and the client report
 * divided a four-term one. Three screens, one campaign, three numbers.
 *
 * The Performance-tab formula wins because it is the one the client-facing PDF
 * and share link already print, and a brand comparing the dashboard against the
 * report it was sent must not find them disagreeing:
 *
 *   (likes + comments + shares + saves) / views
 *
 * over MEASURED posts only -- a post whose counters were never fetched reads
 * as zeroes it never earned, so counting its views in the denominator would
 * dilute the rate towards zero. metricValue's lastSyncedAt rule decides which
 * posts those are, exactly as it does for every other total on these screens.
 *
 * Returns a FRACTION, not a percentage: the report seam, the PDF and both tabs
 * already multiply by 100 at the point of display.
 */
export type EngagementRatePost = {
  viewsCount?: number | null;
  likesCount?: number | null;
  commentsCount?: number | null;
  sharesCount?: number | null;
  savesCount?: number | null;
  lastSyncedAt?: string | Date | null;
};

export type EngagementRollup = {
  /** likes + comments + shares + saves over measured posts; null when none are. */
  engagements: number | null;
  /** Views belonging to the measured posts -- the rate's denominator. */
  measuredViews: number;
  /** engagements / measuredViews as a fraction, or null when unmeasurable. */
  rate: number | null;
};

export function rollupEngagement(
  posts: readonly EngagementRatePost[]
): EngagementRollup {
  const measured = posts.filter((p) => metricValue(p.likesCount, p.lastSyncedAt) !== UNKNOWN);
  if (measured.length === 0) return { engagements: null, measuredViews: 0, rate: null };

  const engagements = measured.reduce(
    (sum, p) =>
      sum +
      sumEngagements({
        likes: p.likesCount,
        comments: p.commentsCount,
        shares: p.sharesCount,
        saves: p.savesCount,
      }),
    0
  );
  const measuredViews = measured.reduce((sum, p) => sum + (p.viewsCount || 0), 0);

  return {
    engagements,
    measuredViews,
    rate: measuredViews > 0 ? engagements / measuredViews : null,
  };
}

/**
 * rollupEngagement's "measured" test, written as a Prisma filter.
 *
 * rollupEngagement keeps a post when `metricValue(likesCount, lastSyncedAt)` is
 * not UNKNOWN -- a positive likes count, or a sync stamp proving we looked. The
 * routes that aggregate in the database cannot load posts to apply that in
 * Node, and each one that reimplemented the denominator inline is how the
 * product ended up with three engagement rates. This is the same predicate, in
 * the one place, so a change to the rule reaches SQL and JavaScript together.
 */
export const MEASURED_POSTS_FILTER: {
  OR: ({ likesCount: { gt: number } } | { lastSyncedAt: { not: null } })[];
} = {
  OR: [{ likesCount: { gt: 0 } }, { lastSyncedAt: { not: null } }],
};

/**
 * rollupEngagement over sums the database already computed under
 * MEASURED_POSTS_FILTER.
 *
 * (sum likes + sum comments + ...) / sum views is exactly what rollupEngagement
 * produces from the individual rows -- the rate is a ratio of totals, not a mean
 * of per-post rates -- so an aggregate answers it without reading a post. Pass
 * `measuredPosts: 0` for an org that has none: the result is null, never 0.
 */
export function rollupEngagementFromTotals(input: {
  measuredPosts: number;
  viewsCount?: number | null;
  likesCount?: number | null;
  commentsCount?: number | null;
  sharesCount?: number | null;
  savesCount?: number | null;
}): EngagementRollup {
  if (input.measuredPosts <= 0) return { engagements: null, measuredViews: 0, rate: null };
  return rollupEngagement([
    {
      viewsCount: input.viewsCount,
      likesCount: input.likesCount,
      commentsCount: input.commentsCount,
      sharesCount: input.sharesCount,
      savesCount: input.savesCount,
      /* The rows behind these sums were already filtered by
         MEASURED_POSTS_FILTER, so this only satisfies rollupEngagement's own
         provenance test -- which would otherwise drop a genuine measured zero. */
      lastSyncedAt: AGGREGATED,
    },
  ]);
}

/** Sentinel stamp for a row the database already proved was measured. */
const AGGREGATED = new Date(0);

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

  /* The rate is rollupEngagement's, not `engagement`/views. The two differ by
     downloads: `engagement` above is CreatorCore's own five-term field, kept
     because it is what their export carries and what this column is audited
     against, while the RATE has one definition across the whole product and
     that definition is the four-term one the client report prints. A tab that
     rated the same campaign differently from the PDF sent to the brand was the
     bug; a five-term total beside a four-term rate is the documented seam. */
  const { rate } = rollupEngagement(posts);
  const campaignRate = rate === null ? UNKNOWN : rate * 100;

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

