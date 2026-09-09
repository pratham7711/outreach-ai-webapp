/**
 * Two settings, deliberately not one.
 *
 * How often we *read* a sound and how densely we *chart* it look like the same
 * knob and are not. Reading is bought from a browser on a VPS at roughly ten
 * seconds a sound, sequentially, and doubling the rate doubles that bill.
 * Charting is a `take` and a downsample over rows that already exist, and costs
 * nothing anyone can feel. Collapsing them into one "granularity" control is how
 * someone picks "hourly" to get a smoother line and saturates the reader.
 *
 * So: readCadence is an operational budget, chartGranularity is a display
 * preference, and they are stored, validated and surfaced separately.
 *
 * The defaults mirror CreatorCore, which is the product being migrated from:
 * daily points, about a year of history.
 */

export const READ_CADENCES = [
  "hourly",
  "2hourly",
  "3hourly",
  "4hourly",
  "6hourly",
  "12hourly",
  "daily",
] as const;
export type ReadCadence = (typeof READ_CADENCES)[number];

export const CHART_GRANULARITIES = ["hourly", "4hourly", "daily", "weekly"] as const;
export type ChartGranularity = (typeof CHART_GRANULARITIES)[number];

/**
 * Hours between reads, per cadence.
 *
 * The cron itself runs hourly and asks this which sounds are actually due, so
 * adding a cadence here is the whole change -- no new schedule, no new job. A
 * 24/N reading of these gives snapshots per day: hourly is 24, 4hourly is 6,
 * daily is 1.
 */
export const READ_CADENCE_HOURS: Record<ReadCadence, number> = {
  hourly: 1,
  "2hourly": 2,
  "3hourly": 3,
  "4hourly": 4,
  "6hourly": 6,
  "12hourly": 12,
  daily: 24,
};

/** Snapshots per day at a cadence — what the settings screen actually shows. */
export function readsPerDay(cadence: ReadCadence): number {
  return 24 / READ_CADENCE_HOURS[cadence];
}

export const CHART_BUCKET_HOURS: Record<ChartGranularity, number> = {
  hourly: 1,
  "4hourly": 4,
  daily: 24,
  weekly: 24 * 7,
};

export type TrackerGranularity = {
  readCadence: ReadCadence;
  chartGranularity: ChartGranularity;
  /**
   * How long snapshots are kept. CreatorCore's audio chart spans about a year
   * (7/28/25 to 7/31/26 across eleven axis labels), so a year is the shape a
   * migrating client already expects to see.
   */
  retentionDays: number;
};

export const DEFAULT_GRANULARITY: TrackerGranularity = {
  /**
   * Twice a day, because that is what CreatorCore actually does.
   *
   * Measured 2026-09-09 by reading their own snapshot rows out of the
   * campaign Analytics page (Bubble `custom.module___statistic`, campaign
   * MONTAGEM KALI): an unbroken series at 03:28 and 15:28 UTC, gap 12.00h
   * every time, drifting ~0.3s per run the way a recurring job does. The
   * irregular rows in between (09:21, 11:35, 14:57, 07:47 ...) are people
   * pressing Refresh Data, not the schedule.
   *
   * This used to be "4hourly", which read six times a day against a
   * reference product that reads twice -- three times the worker time and
   * three times the egress for points no chart ever plots, since
   * chartGranularity is daily. The cron still FIRES hourly; this only
   * decides which trackers come up due, so nothing about the schedule
   * changes, only how often a given sound is actually fetched.
   */
  readCadence: "12hourly",
  chartGranularity: "daily",
  retentionDays: 365,
};

/** Bounds are enforced here rather than at the form, so an edited JSON blob
 *  cannot ask the reader for something it can never deliver. */
export const MIN_RETENTION_DAYS = 7;
export const MAX_RETENTION_DAYS = 1095; // three years

function isReadCadence(v: unknown): v is ReadCadence {
  return typeof v === "string" && (READ_CADENCES as readonly string[]).includes(v);
}

function isChartGranularity(v: unknown): v is ChartGranularity {
  return typeof v === "string" && (CHART_GRANULARITIES as readonly string[]).includes(v);
}

/**
 * Read the org's preference out of the `uiConfig` JSON blob.
 *
 * Every field falls back independently: a blob with a valid cadence and a
 * garbage granularity keeps the cadence. This runs on a column that is
 * hand-edited in practice, so a single bad key must never blank the whole
 * setting and silently re-point the worker.
 */
export function parseGranularity(raw: unknown): TrackerGranularity {
  const src =
    raw && typeof raw === "object" && "trackers" in (raw as Record<string, unknown>)
      ? ((raw as Record<string, unknown>).trackers as Record<string, unknown> | null)
      : null;
  if (!src || typeof src !== "object") return DEFAULT_GRANULARITY;

  const retention = Number(src.retentionDays);
  return {
    readCadence: isReadCadence(src.readCadence)
      ? src.readCadence
      : DEFAULT_GRANULARITY.readCadence,
    chartGranularity: isChartGranularity(src.chartGranularity)
      ? src.chartGranularity
      : DEFAULT_GRANULARITY.chartGranularity,
    retentionDays:
      Number.isFinite(retention) && retention >= MIN_RETENTION_DAYS && retention <= MAX_RETENTION_DAYS
        ? Math.round(retention)
        : DEFAULT_GRANULARITY.retentionDays,
  };
}

/**
 * A reader may not chart finer than it samples.
 *
 * Asking for hourly points from a daily reader does not produce a smoother
 * line; it produces one point per day drawn on an hourly axis, with 23 gaps
 * that look like outages. Clamping here means the settings UI can offer the
 * full menu and still never render a lie.
 */
export type ChartableGranularity = {
  readCadence: ReadCadence;
  chartGranularity: ChartGranularity;
  /* Both TrackerGranularity (retentionDays) and PostTrackingGranularity
     (defaultTtlDays) are clamped by this, and neither extra field is its
     business. The index signature is what lets a literal of either shape be
     passed without the excess-property check rejecting it. */
  [extra: string]: unknown;
};

export function effectiveChartGranularity(g: ChartableGranularity): ChartGranularity {
  const readHours = READ_CADENCE_HOURS[g.readCadence];
  if (CHART_BUCKET_HOURS[g.chartGranularity] >= readHours) return g.chartGranularity;
  const coarsest = CHART_GRANULARITIES.filter(
    (c) => CHART_BUCKET_HOURS[c] >= readHours
  );
  return coarsest[0] ?? "daily";
}

/**
 * How many rows to fetch to cover a window at a given cadence, with headroom.
 *
 * The list endpoint used a flat `take: 60`, which at a four-hourly cadence is
 * ten days — so a year-long chart could not be drawn no matter what the
 * database held. Sizing the fetch from the cadence is what makes the window
 * selector mean anything.
 */
export function snapshotFetchLimit(g: TrackerGranularity, windowDays: number): number {
  const perDay = 24 / READ_CADENCE_HOURS[g.readCadence];
  const needed = Math.ceil(perDay * windowDays * 1.2); // 20% slack for jitter and retries
  return Math.min(Math.max(needed, 60), 5000);
}

/**
 * Collapse raw readings to one point per bucket.
 *
 * The last reading in a bucket wins, not the mean. usesCount is a level — the
 * number of videos presently using the sound — so the value at the close of a
 * day is a real observed state, while an average of six readings is a number
 * that was never true at any moment.
 *
 * Buckets are anchored to epoch rather than to the first sample, so two sounds
 * read at different minutes still land on the same daily gridlines and can be
 * plotted against one another.
 */
export function downsample<T extends { recordedAt: Date }>(
  snapshots: T[],
  granularity: ChartGranularity
): T[] {
  if (snapshots.length === 0) return [];
  const bucketMs = CHART_BUCKET_HOURS[granularity] * 60 * 60 * 1000;

  const byBucket = new Map<number, T>();
  for (const s of snapshots) {
    const t = s.recordedAt.getTime();
    if (!Number.isFinite(t)) continue;
    const bucket = Math.floor(t / bucketMs);
    const held = byBucket.get(bucket);
    if (!held || s.recordedAt.getTime() >= held.recordedAt.getTime()) {
      byBucket.set(bucket, s);
    }
  }

  return [...byBucket.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, s]) => s);
}

/**
 * Whether a sound is due for a reading, given when it was last read.
 *
 * The worker asks the app which sounds to read rather than keeping its own
 * list, so this is where cadence is actually enforced. A small tolerance stops
 * a timer that fires a few seconds early from deferring every sound by a whole
 * cycle.
 */
const DUE_TOLERANCE_MS = 5 * 60 * 1000;

export function isDueForRead(
  lastReadAt: Date | null,
  g: TrackerGranularity,
  now: Date
): boolean {
  if (!lastReadAt) return true; // never read: always due
  const dueAfterMs = READ_CADENCE_HOURS[g.readCadence] * 60 * 60 * 1000;
  return now.getTime() - lastReadAt.getTime() >= dueAfterMs - DUE_TOLERANCE_MS;
}


/* ────────────────────────────────────────────────────────────────────────────
 * Post tracking
 *
 * A tracked post is the third kind of tracker, alongside sounds and creators,
 * and it is deliberately given the SAME vocabulary as the other two: a read
 * cadence that costs money, a chart granularity that does not, and a downsample
 * that collapses readings to one point per bucket. Before this, post metrics
 * were swept on a bespoke age ladder in lib/sync/cadence.ts keyed off the
 * campaign -- a different mental model, a different set of words, and the
 * reason nobody could say how often a given post was actually read.
 *
 * Two things make post tracking different from the other two, and both come
 * straight from the product decision:
 *
 *   1. It is UNLIMITED. Sounds and creators share one pooled plan cap
 *      (lib/trackers/limit.ts) because each is a standing instruction to fetch
 *      a page forever. A post tracker is not forever -- which is what makes
 *      capping it unnecessary.
 *
 *   2. It ALWAYS expires. Every post tracker carries a TTL, chosen by the user,
 *      between one and thirty days. There is no "off" sentinel and no way to
 *      ask for an unbounded one: the bound is what buys the absent count limit.
 *      At the ceiling that is TTL_MAX_DAYS x readsPerDay(cadence) reads per
 *      post -- 180 at the 4-hourly default, 720 if an org asks for hourly --
 *      and then the post seals itself and costs nothing again.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Shortest tracking window a user may ask for. */
export const POST_TTL_MIN_DAYS = 1;
/** Longest tracking window a user may ask for. The ceiling is the product rule,
 *  not a technical limit: it is what keeps an unlimited number of post trackers
 *  from becoming an unbounded standing bill. */
export const POST_TTL_MAX_DAYS = 30;

export type PostTrackingGranularity = {
  readCadence: ReadCadence;
  chartGranularity: ChartGranularity;
  /** The TTL a new post tracker gets when the user does not name one. */
  defaultTtlDays: number;
};

export const DEFAULT_POST_TRACKING: PostTrackingGranularity = {
  /* The same 4-hourly default the sound and creator trackers carry, so the
     three read at one rate until someone deliberately separates them. */
  readCadence: DEFAULT_GRANULARITY.readCadence,
  chartGranularity: DEFAULT_GRANULARITY.chartGranularity,
  /* The ceiling, because a post's interesting life is its first few weeks and a
     user who wanted less can say so. 30 days at 4-hourly is 180 reads. */
  defaultTtlDays: POST_TTL_MAX_DAYS,
};

/** Hold a requested TTL inside the product's bounds. A non-number falls back to
 *  the default rather than to zero -- "always an expiration" cuts both ways, and
 *  a 0-day tracker would expire before its first read. */
export function clampTtlDays(raw: unknown, fallback = DEFAULT_POST_TRACKING.defaultTtlDays): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(POST_TTL_MAX_DAYS, Math.max(POST_TTL_MIN_DAYS, Math.round(n)));
}

/** When a tracker started at `from` with a `ttlDays` window stops being read. */
export function postTrackingExpiry(from: Date, ttlDays: number): Date {
  return new Date(from.getTime() + clampTtlDays(ttlDays) * 24 * 60 * 60 * 1000);
}

/**
 * Read the org's post-tracking preference out of `uiConfig.postTracking`.
 *
 * Kept in its own key rather than folded into `trackers`, for the same reason
 * readCadence and chartGranularity are two fields and not one: a sound is read
 * from a browser at ~10s a sound and there are tens of them, while posts are
 * read from APIs and there are tens of thousands. Sharing a default is fine;
 * sharing a control would mean an org that slows its sounds down also, silently,
 * slows every campaign report.
 *
 * Every field falls back independently, so one bad key cannot blank the block
 * and re-point the worker.
 */
export function parsePostTracking(raw: unknown): PostTrackingGranularity {
  const src =
    raw && typeof raw === "object" && "postTracking" in (raw as Record<string, unknown>)
      ? ((raw as Record<string, unknown>).postTracking as Record<string, unknown> | null)
      : null;
  if (!src || typeof src !== "object") return DEFAULT_POST_TRACKING;

  const ttl = Number(src.defaultTtlDays);
  return {
    readCadence: isReadCadence(src.readCadence)
      ? src.readCadence
      : DEFAULT_POST_TRACKING.readCadence,
    chartGranularity: isChartGranularity(src.chartGranularity)
      ? src.chartGranularity
      : DEFAULT_POST_TRACKING.chartGranularity,
    defaultTtlDays:
      Number.isFinite(ttl) && ttl >= POST_TTL_MIN_DAYS && ttl <= POST_TTL_MAX_DAYS
        ? Math.round(ttl)
        : DEFAULT_POST_TRACKING.defaultTtlDays,
  };
}

/** Reads one post tracker will spend over a full TTL window at a cadence.
 *  What the settings screen shows so the ceiling is a number, not a vibe. */
export function readsPerTrackedPost(g: PostTrackingGranularity, ttlDays: number): number {
  return Math.round(readsPerDay(g.readCadence) * clampTtlDays(ttlDays, g.defaultTtlDays));
}
