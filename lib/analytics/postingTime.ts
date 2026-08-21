export type TimedPost = {
  postedAt: string | Date;
  platform: string;
  viewsCount: number;
};

export type TimeBucket = {
  /** 0 = Sunday … 6 = Saturday, in the requested timezone. */
  day: number;
  /** 0 … 23, in the requested timezone. */
  hour: number;
  count: number;
  /** Median, not mean — see medianOf. 0 when the bucket is empty. */
  medianViews: number;
};

export type PostingTimeReport = {
  buckets: TimeBucket[];
  /** Buckets clearing minSample, best median first. Empty when nothing qualifies. */
  best: TimeBucket[];
  totalPosts: number;
  /** Highest median across buckets that cleared minSample — the colour scale ceiling. */
  scaleMax: number;
  minSample: number;
  timeZone: string;
};

export const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

/**
 * View counts are heavy-tailed: one post going viral in a slot would drag a mean
 * up and make an otherwise ordinary hour look like the best time to post. The
 * median describes the typical post in that slot, which is the thing you can
 * actually plan around.
 */
export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Local weekday + hour for an instant. A posting hour only means anything in
 *  the audience's own clock, so everything is bucketed in one stated zone. */
export function localSlot(date: Date, timeZone: string): { day: number; hour: number } | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = parts.find((p) => p.type === "hour")?.value;
  if (weekday === undefined || hour === undefined) return null;
  const day = WEEKDAY_INDEX[weekday];
  const h = Number(hour);
  if (day === undefined || !Number.isInteger(h)) return null;
  return { day, hour: h % 24 };
}

export function resolveTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

/**
 * Buckets posts into the 168 weekday×hour slots and ranks them.
 *
 * `minSample` is the honesty knob. A slot holding a single post is an anecdote,
 * not a best time to post, so slots below the threshold are still charted (you
 * can see where the coverage is thin) but are never recommended.
 */
export function postingTimeReport(
  posts: TimedPost[],
  opts: { timeZone?: string; minSample?: number; platform?: string } = {},
): PostingTimeReport {
  const timeZone = opts.timeZone ?? "UTC";
  const minSample = Math.max(1, opts.minSample ?? 3);

  const relevant =
    opts.platform && opts.platform !== "ALL"
      ? posts.filter((p) => p.platform === opts.platform)
      : posts;

  const grouped = new Map<string, number[]>();
  let totalPosts = 0;

  for (const post of relevant) {
    const date = post.postedAt instanceof Date ? post.postedAt : new Date(post.postedAt);
    const slot = localSlot(date, timeZone);
    if (!slot) continue;
    const views = Number(post.viewsCount);
    if (!Number.isFinite(views)) continue;
    const key = `${slot.day}-${slot.hour}`;
    const list = grouped.get(key);
    if (list) list.push(views);
    else grouped.set(key, [views]);
    totalPosts += 1;
  }

  const sparse: TimeBucket[] = [];
  for (const [key, values] of grouped) {
    const [day, hour] = key.split("-").map(Number);
    sparse.push({ day, hour, count: values.length, medianViews: medianOf(values) });
  }

  // Same tail as the aggregated path, so the two cannot rank slots differently.
  return postingTimeReportFromBuckets(sparse, { timeZone, minSample, totalPosts });
}

/**
 * Builds the report from buckets that were already grouped and medianed
 * elsewhere — in practice by Postgres, via percentile_cont over the posting
 * hour, so the whole post table never has to be read into Node just to be
 * bucketed. Rows may be sparse; the empty slots are filled in here.
 *
 * Defensive about its input because that input is raw SQL output rather than a
 * typed model: COUNT() arrives as a bigint, percentile_cont as a numeric that
 * can be null for an empty group, and a malformed row must drop out rather than
 * land in slot NaN.
 */
export function postingTimeReportFromBuckets(
  rows: readonly { day: number; hour: number; count: number; medianViews: number }[],
  opts: { timeZone?: string; minSample?: number; totalPosts?: number } = {},
): PostingTimeReport {
  const timeZone = opts.timeZone ?? "UTC";
  const minSample = Math.max(1, opts.minSample ?? 3);

  const byKey = new Map<string, { count: number; medianViews: number }>();
  let counted = 0;
  for (const row of rows) {
    const day = Number(row.day);
    const hour = Number(row.hour);
    const count = Number(row.count);
    const medianViews = Number(row.medianViews);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    if (!Number.isFinite(count) || count <= 0) continue;
    byKey.set(`${day}-${hour}`, {
      count,
      medianViews: Number.isFinite(medianViews) ? medianViews : 0,
    });
    counted += count;
  }

  const buckets: TimeBucket[] = [];
  for (let day = 0; day < 7; day += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      const hit = byKey.get(`${day}-${hour}`);
      buckets.push({ day, hour, count: hit?.count ?? 0, medianViews: hit?.medianViews ?? 0 });
    }
  }

  const qualified = buckets.filter((b) => b.count >= minSample);
  const best = [...qualified].sort(
    (a, b) => b.medianViews - a.medianViews || b.count - a.count || a.day - b.day || a.hour - b.hour,
  );

  return {
    buckets,
    best,
    totalPosts: opts.totalPosts ?? counted,
    scaleMax: qualified.reduce((max, b) => Math.max(max, b.medianViews), 0),
    minSample,
    timeZone,
  };
}

/** "Thu 19:00" — one slot, stated in the report's timezone. */
export function formatSlot(bucket: Pick<TimeBucket, "day" | "hour">): string {
  return `${DAY_LABELS[bucket.day]} ${String(bucket.hour).padStart(2, "0")}:00`;
}
