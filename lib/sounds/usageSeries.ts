import { usesPrecisionOf, type UsesPrecision } from "@/lib/sounds/precision";
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
 *  - A change needs both ends exact and adjacent. Velocity across a precision
 *    change, or across empty buckets, is null rather than a figure that is the
 *    rounding or several buckets' worth of growth drawn as one.
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
  /** Percent change from the previous point; null where that is not knowable. */
  velocity: number | null;
};

const HOUR_MS = 60 * 60 * 1000;

export function soundSeries(
  rows: readonly SoundReadingRow[],
  { bucketHours }: { bucketHours: number },
): SoundSeriesPoint[] {
  const bucketMs = Math.max(1, bucketHours) * HOUR_MS;
  const readings = rows
    .map((r) => ({ t: r.recordedAt.getTime(), usesCount: r.usesCount, precision: usesPrecisionOf(r.usesCount) }))
    .filter((r) => Number.isFinite(r.t) && Number.isFinite(r.usesCount))
    .sort((a, b) => a.t - b.t);

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
    out.push({
      t: r.t,
      usesCount: r.usesCount,
      precision: r.precision,
      velocity:
        prev && adjacent && prev.precision === "exact" && r.precision === "exact"
          ? velocityBetween(prev.usesCount, r.usesCount)
          : null,
    });
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
