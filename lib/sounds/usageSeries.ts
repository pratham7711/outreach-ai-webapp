import { roundingStep, usesPrecisionOf, type UsesPrecision } from "@/lib/sounds/precision";
import { velocityBetween } from "@/lib/trackers/metrics";

/**
 * A sound's use count as a chart series: one reading per bucket, oldest first,
 * and only readings that may stand beside each other.
 *
 * Shared by the campaign audio card and the trackers page so the two draw the
 * same curve. Both used to chart raw rows -- the card the last 60, the trackers
 * page a downsample of them -- and production's rows are not all readings worth
 * a point:
 *
 *  - Five readings two seconds apart (a refresh pressed repeatedly) were five
 *    points, bunched under one label on a categorical axis. One per bucket.
 *  - A rounded figure ("74K") between two exact counts draws a step that is the
 *    rounding, not the sound. Where exact readings exist on both sides of a
 *    rounded one, the rounded one is dropped; inside a bucket an exact reading
 *    wins over a later rounded one. A rounded run before the first exact reading
 *    or after the last one is kept -- it is the only record of that stretch,
 *    and Instagram never prints more than "15K" for a sound past 10K.
 *  - Between two exact readings, velocity is the change from the adjacent
 *    bucket; across empty buckets it is null rather than several buckets'
 *    growth drawn as one.
 *  - Where an end is rounded, the change is only the rounding until it is
 *    several rounding steps wide -- see approxVelocity. That case is every
 *    TikTok sound past 10K uses, which is nearly every campaign sound, so a
 *    rule of "exact on both ends" left the Velocity chart empty for all of them.
 *
 * Each point keeps its reading's own time (`t`), so a time-scaled axis puts it
 * where it happened rather than at its bucket's edge.
 */

export type SoundReadingRow = { recordedAt: Date; usesCount: number };

export type SoundSeriesPoint = {
  /** Epoch ms of the reading. */
  t: number;
  usesCount: number;
  precision: UsesPrecision;
  /** Percent change per bucket; null where that is not knowable. */
  velocity: number | null;
  /** True when velocity was measured across a rounded figure (see approxVelocity). */
  velocityApprox: boolean;
};

const HOUR_MS = 60 * 60 * 1000;

/* A rounded end can be off by up to its own rounding step -- a full step, not
   half, because a platform that truncates ("15K" for 15,999) is off by that
   much. A change five times the combined uncertainty keeps the rounding under
   a fifth of it. */
const RESOLVE_STEPS = 5;
/* How far back a rounded reading may look for a change that wide: three days,
   or three buckets where a bucket is longer than a day. */
const REACH_MIN_MS = 72 * HOUR_MS;

type Uncertainty = (p: { usesCount: number; precision: UsesPrecision }) => number;

/* A figure's own digits give only the worst case: 273,000 read alone could be
   "273K", rounded to the thousand. A platform prints one sound's figures of one
   size in one format, so beside 271,200 and 274,800 it is "273.0K", rounded to
   the hundred like them. Figures printed to the hundred land on a round
   thousand one time in ten, and each such day left a gap in the chart. */
function roundingBySize(readings: readonly { usesCount: number; precision: UsesPrecision }[]): Uncertainty {
  const size = (uses: number) => String(Math.trunc(uses)).length;
  const finest = new Map<number, number>();
  for (const r of readings) {
    if (r.precision !== "rounded") continue;
    finest.set(size(r.usesCount), Math.min(finest.get(size(r.usesCount)) ?? Infinity, roundingStep(r.usesCount)));
  }
  return (p) =>
    p.precision === "rounded" ? Math.min(roundingStep(p.usesCount), finest.get(size(p.usesCount)) ?? Infinity) : 0;
}

/**
 * Velocity at point `i` when an end of the change is a rounded figure: the
 * nearest earlier point, within reach, whose difference is at least
 * RESOLVE_STEPS times the rounding on both ends, with the change expressed per
 * bucket so a span of three days reads on the same scale as a span of one.
 *
 * At 281,900 TikTok rounds to the hundred, so a day that adds 1,800 videos is
 * measured day on day; a slow day looks further back until the change is wide
 * enough, and one that never gets there within reach has no velocity.
 */
function approxVelocity(
  points: readonly SoundSeriesPoint[],
  i: number,
  bucketMs: number,
  uncertainty: Uncertainty,
): number | null {
  const cur = points[i];
  const reach = Math.max(3 * bucketMs, REACH_MIN_MS);
  for (let j = i - 1; j >= 0; j--) {
    const ref = points[j];
    const elapsed = cur.t - ref.t;
    if (elapsed > reach) break;
    /* Two readings an hour apart either side of a bucket edge, scaled up to a
       whole bucket, would be noise multiplied. */
    if (elapsed < bucketMs / 2 || ref.usesCount <= 0) continue;
    if (Math.abs(cur.usesCount - ref.usesCount) < RESOLVE_STEPS * (uncertainty(cur) + uncertainty(ref))) continue;
    const perBucket = (Math.pow(cur.usesCount / ref.usesCount, bucketMs / elapsed) - 1) * 100;
    return Math.round(perBucket * 100) / 100;
  }
  return null;
}

export function soundSeries(
  rows: readonly SoundReadingRow[],
  { bucketHours }: { bucketHours: number },
): SoundSeriesPoint[] {
  const bucketMs = Math.max(1, bucketHours) * HOUR_MS;
  const readings = rows
    .map((r) => ({ t: r.recordedAt.getTime(), usesCount: r.usesCount, precision: usesPrecisionOf(r.usesCount) }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.usesCount))
    .sort((a, b) => a.t - b.t);

  const uncertainty = roundingBySize(readings);

  let firstExact = -1;
  let lastExact = -1;
  readings.forEach((r, i) => {
    if (r.precision !== "exact") return;
    if (firstExact < 0) firstExact = i;
    lastExact = i;
  });
  const standing = readings.filter(
    (r, i) => r.precision === "exact" || firstExact < 0 || i < firstExact || i > lastExact,
  );

  /* Epoch-anchored buckets, the same anchoring lib/trackers/granularity's
     downsample uses, so a bucket means one thing on every screen. */
  const byBucket = new Map<number, (typeof standing)[number]>();
  for (const r of standing) {
    const key = Math.floor(r.t / bucketMs);
    const held = byBucket.get(key);
    if (!held || held.precision === r.precision || r.precision === "exact") byBucket.set(key, r);
  }

  const keys = [...byBucket.keys()].sort((a, b) => a - b);
  const out: SoundSeriesPoint[] = [];
  keys.forEach((key, i) => {
    const r = byBucket.get(key)!;
    const prevKey = i > 0 ? keys[i - 1] : null;
    const prev = prevKey === null ? null : byBucket.get(prevKey)!;
    const adjacent = prevKey !== null && key - prevKey === 1;
    const exact = prev && adjacent && prev.precision === "exact" && r.precision === "exact";
    out.push({
      t: r.t,
      usesCount: r.usesCount,
      precision: r.precision,
      velocity: exact ? velocityBetween(prev.usesCount, r.usesCount) : null,
      velocityApprox: false,
    });
    if (!exact && (r.precision === "rounded" || prev?.precision === "rounded")) {
      const v = approxVelocity(out, out.length - 1, bucketMs, uncertainty);
      if (v !== null) Object.assign(out[out.length - 1], { velocity: v, velocityApprox: true });
    }
  });
  return out;
}

/**
 * "Videos added since the last sync", from the two newest readings -- or null
 * when either is a rounded figure, or there are not two. Recomputed from the
 * levels rather than read from the stored column, because rows written before
 * the precision rule hold the rounding as a count (+100, +400 on a 74K sound).
 */
export function videosAddedSinceLast(newestFirst: readonly SoundReadingRow[]): number | null {
  const [latest, previous] = newestFirst;
  if (!latest || !previous) return null;
  if (usesPrecisionOf(latest.usesCount) !== "exact" || usesPrecisionOf(previous.usesCount) !== "exact") return null;
  return Math.max(0, Math.round(latest.usesCount - previous.usesCount));
}
