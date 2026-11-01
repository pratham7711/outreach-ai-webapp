/**
 * One chart, two readings of the same series: what happened in each period
 * ("Daily", or Weekly/Monthly when the buckets are wider) and the running total
 * ("Cumulative").
 *
 * A chart's data is one of two kinds, and the conversion goes one way for each:
 *
 * - A LEVEL is a running total read at a moment (a post's lifetime views at a
 *   snapshot, an account's followers). Its per-period figure is the change from
 *   the previous period -- `toChanges`.
 * - A FLOW is what happened inside a period (joins that day, payouts that
 *   month). Its cumulative figure is the running sum -- `toRunningTotals`.
 *
 * A change is only stated between two ADJACENT periods. Across a gap the
 * difference is real but belongs to several periods, and drawing it as one
 * period's bar would invent a spike; it is left null, which the chart draws as
 * a gap. The first period has nothing before it and is null for the same
 * reason. A fall (a post removed, a platform correcting its count) is kept as a
 * negative change rather than hidden: it happened.
 */

export type SeriesMode = "daily" | "cumulative";

const DAY_MS = 24 * 60 * 60 * 1000;
/** 1970-01-01 was a Thursday; week numbers count from the Monday after. */
const FIRST_EPOCH_MONDAY = Date.UTC(1970, 0, 5);

/**
 * A period key as an integer, so that consecutive periods differ by exactly 1.
 * Understands the keys the charts use: "YYYY-MM-DD" (a UTC day), "YYYY-Www"
 * (an ISO week) and "YYYY-MM" (a month). Anything else is null.
 */
export function periodIndex(key: string): number | null {
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (m) return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / DAY_MS;
  m = /^(\d{4})-W(\d{2})$/.exec(key);
  if (m) {
    const jan4 = Date.UTC(Number(m[1]), 0, 4);
    const week1Monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
    const monday = week1Monday + (Number(m[2]) - 1) * 7 * DAY_MS;
    return Math.round((monday - FIRST_EPOCH_MONDAY) / (7 * DAY_MS));
  }
  m = /^(\d{4})-(\d{2})$/.exec(key);
  if (m) return Number(m[1]) * 12 + Number(m[2]) - 1;
  return null;
}

/** "day", "week" or "month", read off the shape of a period key. */
export function periodNoun(key: string | undefined): "day" | "week" | "month" {
  if (key && /^\d{4}-W\d{2}$/.test(key)) return "week";
  if (key && /^\d{4}-\d{2}$/.test(key)) return "month";
  return "day";
}

/** "Daily", "Weekly" or "Monthly", read off the shape of a period key. */
export function periodLabel(key: string | undefined): "Daily" | "Weekly" | "Monthly" {
  return ({ day: "Daily", week: "Weekly", month: "Monthly" } as const)[periodNoun(key)];
}

/** Adjacency for rows keyed by a period string (see `periodIndex`). */
export function nextPeriodBy<T>(key: (row: T) => string): (prev: T, cur: T) => boolean {
  return (prev, cur) => {
    const a = periodIndex(key(prev));
    const b = periodIndex(key(cur));
    return a !== null && b !== null && b - a === 1;
  };
}

/** Adjacency for rows keyed by an instant, bucketed every `bucketHours`. */
export function nextBucketBy<T>(at: (row: T) => number, bucketHours: number): (prev: T, cur: T) => boolean {
  const size = bucketHours * 60 * 60 * 1000;
  return (prev, cur) => Math.floor(at(cur) / size) - Math.floor(at(prev) / size) === 1;
}

function finite(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/**
 * Per-period change of each LEVEL key: the row's value minus the previous
 * row's, or null when there is no previous row, the previous row is not the
 * adjacent period, or either value is missing. Other fields pass through.
 */
export function toChanges<T extends object, K extends keyof T & string>(
  rows: readonly T[],
  keys: readonly K[],
  isNext: (prev: T, cur: T) => boolean = () => true,
): Array<Omit<T, K> & Record<K, number | null>> {
  return rows.map((row, i) => {
    const prev = i > 0 ? rows[i - 1] : undefined;
    const adjacent = prev !== undefined && isNext(prev, row);
    const out = { ...row } as Record<string, unknown>;
    for (const k of keys) {
      const cur = row[k];
      const before = prev?.[k];
      out[k] = adjacent && finite(cur) && finite(before) ? cur - before : null;
    }
    return out as Omit<T, K> & Record<K, number | null>;
  });
}

/**
 * Running total of each FLOW key from the first row. A missing value adds
 * nothing and the total carries; other fields pass through.
 */
export function toRunningTotals<T extends object, K extends keyof T & string>(
  rows: readonly T[],
  keys: readonly K[],
): Array<Omit<T, K> & Record<K, number>> {
  const running = new Map<K, number>(keys.map((k) => [k, 0]));
  return rows.map((row) => {
    const out = { ...row } as Record<string, unknown>;
    for (const k of keys) {
      const v = row[k];
      const total = (running.get(k) ?? 0) + (finite(v) ? v : 0);
      running.set(k, total);
      out[k] = total;
    }
    return out as Omit<T, K> & Record<K, number>;
  });
}

/**
 * Every UTC day from the first row's to the last's, with `empty(day)` standing
 * in for a day that has no row. For a FLOW keyed by day, a day with no row is a
 * day on which nothing happened, and a per-day chart has to show it as such.
 */
export function fillUtcDays<T>(rows: readonly T[], day: (row: T) => string, empty: (day: string) => T): T[] {
  if (rows.length < 2) return [...rows];
  const byDay = new Map(rows.map((r) => [day(r), r]));
  const first = periodIndex(day(rows[0]));
  const last = periodIndex(day(rows[rows.length - 1]));
  if (first === null || last === null || last < first || last - first > 3660) return [...rows];
  const out: T[] = [];
  for (let i = first; i <= last; i++) {
    const key = new Date(i * DAY_MS).toISOString().slice(0, 10);
    out.push(byDay.get(key) ?? empty(key));
  }
  return out;
}

/** Past this many buckets the slots are not filled; the same cap the trackers use. */
const MAX_BUCKET_SLOTS = 2_000;

/**
 * Per-bucket change of LEVEL readings taken at irregular instants: the last
 * reading in each bucket, minus the last reading in the bucket before. One
 * slot per bucket from the first to the last, so the bars are to scale; a
 * bucket next to an empty one has no change (null), and the first bucket,
 * having nothing before it, is not a slot. `t` is the bucket's start.
 */
export function bucketChanges<T extends object, K extends keyof T & string>(
  rows: readonly T[],
  at: (row: T) => number,
  keys: readonly K[],
  bucketHours: number,
): Array<{ t: number } & Record<K, number | null>> {
  const size = bucketHours * 60 * 60 * 1000;
  const sorted = rows.filter((r) => Number.isFinite(at(r))).slice().sort((a, b) => at(a) - at(b));
  if (sorted.length < 2 || !(size > 0)) return [];
  const byBucket = new Map<number, T>();
  for (const r of sorted) byBucket.set(Math.floor(at(r) / size), r);
  const first = Math.floor(at(sorted[0]) / size);
  const last = Math.floor(at(sorted[sorted.length - 1]) / size);
  const slots =
    last - first <= MAX_BUCKET_SLOTS
      ? Array.from({ length: last - first + 1 }, (_, i) => first + i)
      : [...byBucket.keys()].sort((a, b) => a - b);
  const out: Array<{ t: number } & Record<K, number | null>> = [];
  for (let i = 1; i < slots.length; i++) {
    const cur = byBucket.get(slots[i]);
    const prev = slots[i] - slots[i - 1] === 1 ? byBucket.get(slots[i - 1]) : undefined;
    const slot: Record<string, number | null> = { t: slots[i] * size };
    for (const k of keys) {
      const a = cur?.[k];
      const b = prev?.[k];
      slot[k] = finite(a) && finite(b) ? a - b : null;
    }
    out.push(slot as { t: number } & Record<K, number | null>);
  }
  return out;
}

/**
 * How far back a chart looks. "All" is every reading, which is what each chart
 * showed before ranges existed, so it is the default everywhere.
 */
export type ChartRange = "7d" | "30d" | "90d" | "all";

export const CHART_RANGES: readonly { value: ChartRange; label: string; days: number | null }[] = [
  { value: "7d", label: "7D", days: 7 },
  { value: "30d", label: "30D", days: 30 },
  { value: "90d", label: "90D", days: 90 },
  { value: "all", label: "All", days: null },
];

/**
 * The first UTC day a range keeps, as YYYY-MM-DD, counting today as its last
 * day ("7D" is today and the six days before it). Null for "All".
 *
 * The window is cut AFTER a chart works out its per-day changes, never before:
 * cut first and the window's first day would lose the reading it is measured
 * from and draw as a gap.
 */
export function rangeStartDay(range: ChartRange, nowMs: number = Date.now()): string | null {
  const days = CHART_RANGES.find((r) => r.value === range)?.days ?? null;
  if (days === null) return null;
  const today = Math.floor(nowMs / DAY_MS);
  return new Date((today - (days - 1)) * DAY_MS).toISOString().slice(0, 10);
}

/** The same cut as an instant, for charts on a time axis. Null for "All". */
export function rangeStartMs(range: ChartRange, nowMs: number = Date.now()): number | null {
  const day = rangeStartDay(range, nowMs);
  return day === null ? null : Date.parse(`${day}T00:00:00Z`);
}

/** The rows whose UTC day falls inside the range; every row for "All". */
export function withinRange<T>(rows: readonly T[], day: (row: T) => string, range: ChartRange, nowMs?: number): T[] {
  const start = rangeStartDay(range, nowMs);
  return start === null ? [...rows] : rows.filter((r) => day(r).slice(0, 10) >= start);
}
