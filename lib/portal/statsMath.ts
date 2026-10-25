/**
 * The arithmetic behind My stats' comparisons, kept apart from the screen so
 * each rule is tested on its own. None of it invents a figure: every function
 * returns null when the inputs do not support an answer, and the screen then
 * leaves the comparison out rather than showing a zero.
 */

export type TrendPoint = { day: string; followers: number };
export type Trend = { platform: string; handle: string; source: "public_profile"; points: TrendPoint[] };

type PostCounts = { views: number | null; likes: number | null; comments: number | null; shares: number | null };

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Likes, comments and shares per view on one post. Shares count only where the
 * platform reports them. Null when views were not measured or are zero, or when
 * neither likes nor comments came back (a creator who hid like counts and has
 * comments off has no measurable engagement, not zero engagement).
 */
export function engagementPerView(post: PostCounts): number | null {
  if (typeof post.views !== "number" || post.views <= 0) return null;
  if (post.likes === null && post.comments === null) return null;
  return ((post.likes ?? 0) + (post.comments ?? 0) + (post.shares ?? 0)) / post.views;
}

/** The median of engagementPerView over the posts that have one. */
export function medianEngagementPerView(posts: PostCounts[]): number | null {
  return median(posts.map(engagementPerView).filter((r): r is number => r !== null));
}

/**
 * How a post's views compare with the account's median, as a multiple. Null
 * unless both are measured and there were enough posts for a median to mean
 * "typical" (three or more).
 */
export function timesMedian(views: number | null, medianViews: number | null, sampleSize: number): number | null {
  if (typeof views !== "number" || typeof medianViews !== "number" || medianViews <= 0 || sampleSize < 3) return null;
  return views / medianViews;
}

const bare = (handle: string) => handle.trim().replace(/^@/, "").toLowerCase();

/** The tracker's readings for a connected account: same platform, same handle
    with or without its @, in any case. */
export function trendForAccount(trends: Trend[], platform: string, handle: string): Trend | null {
  const h = bare(handle);
  return trends.find((t) => t.platform.toUpperCase() === platform.toUpperCase() && bare(t.handle) === h) ?? null;
}

export type TrendChange = {
  from: number;
  to: number;
  change: number;
  /** Null when the starting figure was zero. */
  pct: number | null;
  /** The day the comparison starts from. */
  since: string;
  /** True when the readings reach back the whole window; false when they
      start later and the change is "since" their first day. */
  wholeWindow: boolean;
};

/**
 * Followers gained (or lost) over the last `days` days of readings: from the
 * first reading on or after the window's start to the newest. Null with fewer
 * than two readings, since one reading has nothing to compare with.
 */
export function trendChange(points: TrendPoint[], days = 30): TrendChange | null {
  if (points.length < 2) return null;
  const last = points[points.length - 1];
  const start = Date.parse(`${last.day}T00:00:00Z`) - days * 86_400_000;
  const first = points.find((p) => Date.parse(`${p.day}T00:00:00Z`) >= start) ?? points[0];
  if (first === last) return null;
  const wholeWindow = Date.parse(`${points[0].day}T00:00:00Z`) <= start;
  const change = last.followers - first.followers;
  return { from: first.followers, to: last.followers, change, pct: first.followers > 0 ? change / first.followers : null, since: first.day, wholeWindow };
}
