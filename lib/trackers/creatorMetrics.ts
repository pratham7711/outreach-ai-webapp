import { windowHours, type TrackerWindow } from "./metrics";

/**
 * Creator trackers, and why they measure views rather than followers.
 *
 * The reference shows two figures per creator — Followers and Avg. Views — each
 * with a Change cell, and in the captured state every Change cell on the page
 * reads "No data yet.". It keeps a follower count it cannot yet trend.
 *
 * We are in a worse position on followers and a better one on views.
 * Creator.followersCount is populated on 11 of 1,834 creators and averageViews
 * on exactly 1, both being Float @default(0) — so printing them straight would
 * report a measured zero for everyone the import never filled. There is no
 * follower history table either, so a follower trend is not available at any
 * price we can pay right now.
 *
 * Views we do have: 18,708 posts carrying postedAt and viewsCount across 1,830
 * of those creators. So Avg. Views here is the mean views of a creator's posts
 * inside the selected window, and its change is the same figure over the window
 * immediately before it. Value and change come from one source, which is the
 * point — a change computed against a differently-sourced headline would be a
 * percentage of two different things.
 */

const HOUR_MS = 1000 * 60 * 60;

export type CreatorWindowRow = {
  creatorId: string;
  avgCurrent: number | null;
  postsCurrent: number;
  avgPrevious: number | null;
  postsPrevious: number;
};

export type CreatorWindowMetrics = {
  /** Mean views of posts inside the window; null when the creator posted none. */
  avgViews: number | null;
  postsInWindow: number;
  /** Percentage change against the preceding window of equal length. */
  changePercent: number | null;
  /** Why changePercent is null, for the tooltip. Null when it is not. */
  changeAbsentReason: "no-posts-in-window" | "no-posts-before" | "zero-baseline" | null;
  postsInPrevious: number;
};

export type CreatorWindowBounds = {
  /** Start of the window being reported. */
  current: Date;
  /** Start of the window before it, of equal length. */
  previous: Date;
};

/** The two cut-offs the aggregate needs: [previous, current) and [current, now]. */
export function windowBounds(window: TrackerWindow, now: Date): CreatorWindowBounds {
  const span = windowHours(window) * HOUR_MS;
  return {
    current: new Date(now.getTime() - span),
    previous: new Date(now.getTime() - span * 2),
  };
}

/**
 * A number arriving from Postgres may be a string (numeric) or null (avg over an
 * empty set), and a count is a bigint. Anything that is not a finite number is
 * absent, never zero.
 */
export function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function metricsFromRow(row: CreatorWindowRow | undefined): CreatorWindowMetrics {
  const postsCurrent = row?.postsCurrent ?? 0;
  const postsPrevious = row?.postsPrevious ?? 0;
  const avgCurrent = postsCurrent > 0 ? (row?.avgCurrent ?? null) : null;
  const avgPrevious = postsPrevious > 0 ? (row?.avgPrevious ?? null) : null;

  let changePercent: number | null = null;
  let changeAbsentReason: CreatorWindowMetrics["changeAbsentReason"] = null;

  if (avgCurrent === null) {
    changeAbsentReason = "no-posts-in-window";
  } else if (avgPrevious === null) {
    changeAbsentReason = "no-posts-before";
  } else if (avgPrevious <= 0) {
    // Every post in the earlier window measured zero views. Growth from nothing
    // has no percentage, and calling it +100% would invent a denominator.
    changeAbsentReason = "zero-baseline";
  } else {
    changePercent = Math.round(((avgCurrent - avgPrevious) / avgPrevious) * 10000) / 100;
  }

  return {
    avgViews: avgCurrent,
    postsInWindow: postsCurrent,
    changePercent,
    changeAbsentReason,
    postsInPrevious: postsPrevious,
  };
}

/**
 * Followers are reported only where the import actually filled them. The column
 * defaults to 0, so a 0 is the absence of a reading rather than a creator with
 * no audience — the same rule lib/metricDisplay.ts applies to post counters.
 */
export function followerCount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

export const CREATOR_TRACKER_SORTS = ["views", "change", "posts", "followers"] as const;
export type CreatorTrackerSort = (typeof CREATOR_TRACKER_SORTS)[number];

export function isCreatorTrackerSort(value: string | null): value is CreatorTrackerSort {
  return CREATOR_TRACKER_SORTS.includes(value as CreatorTrackerSort);
}

type SortableCreator = {
  metrics: Pick<CreatorWindowMetrics, "avgViews" | "changePercent" | "postsInWindow">;
  followersCount: number | null;
};

export function sortValueFor(row: SortableCreator, sort: CreatorTrackerSort): number | null {
  if (sort === "change") return row.metrics.changePercent;
  if (sort === "posts") return row.metrics.postsInWindow > 0 ? row.metrics.postsInWindow : null;
  if (sort === "followers") return row.followersCount;
  return row.metrics.avgViews;
}

/**
 * Highest first, with the unmeasured always last. A creator we know nothing
 * about must not head a leaderboard because null happened to sort high.
 */
export function byMetricDescending<T extends SortableCreator>(
  rows: readonly T[],
  sort: CreatorTrackerSort
): T[] {
  return [...rows].sort((a, b) => {
    const av = sortValueFor(a, sort);
    const bv = sortValueFor(b, sort);
    if (av === null && bv === null) return 0;
    if (av === null) return 1;
    if (bv === null) return -1;
    return bv - av;
  });
}
