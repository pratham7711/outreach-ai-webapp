import { velocityBetween } from "@/lib/trackers/metrics";

/**
 * Whether a sound's use count is the platform's exact figure or its display
 * rounding -- "73.9K", "15K" -- and what may be derived from each.
 *
 * Both readers can land on a rounded figure. Instagram's audio page only ever
 * prints one ("15K reels"); its parser knows, and says so. TikTok's music embed
 * prints an exact count for a small sound ("videoCount":44) but, measured on
 * production 2026-10-03, every one of the 33 readings of a sound near 74K was a
 * multiple of 100 (73,500 to 74,100, six distinct values, wandering both ways):
 * the K-rounded figure, not a count. /api/music/detail, which only a browser
 * can read, carries the same figure: measured 2026-10-18 from a sin1 Vercel
 * Sandbox, `stats.videoCount` was 268,700 and 73,800 for two sounds, the
 * embed said 73,800 for the second in the same minute, and no other count is
 * in that answer or in /api/music/item_list's. Above 10K TikTok shows a
 * logged-out reader no exact count for a sound.
 *
 * Nothing in the schema records which a stored reading was -- SoundTrackerSnapshot
 * has no source column and adding one is prod DDL -- so a stored reading's
 * precision is inferred from its value: 10,000 or more and a multiple of 100 is
 * what both platforms' rounding produces, and below 10,000 both print the count.
 * An exact count that happens to be a multiple of 100 is mistaken for a rounded
 * one about one time in a hundred; the cost of that is one reading with no
 * "videos added", which is the cheap direction to be wrong in.
 *
 * The rules that follow, everywhere a sound reading is written or drawn:
 *  - a change ("videos added", velocity) needs an exact reading on BOTH ends;
 *    the difference between two roundings is the rounding, not new videos --
 *    production stored "+100", "+400", "+300" for that 74K sound, 2,500 in all;
 *  - a rounded reading does not replace an exact one it agrees with;
 *  - in a series, a rounded reading does not sit between exact ones.
 */

export type UsesPrecision = "exact" | "rounded";

/** Where both platforms switch from a count to "12K" / "12.3K". */
export const ROUNDED_FROM = 10_000;

/** A stored reading's precision, inferred from its value -- see the header. */
export function usesPrecisionOf(uses: number): UsesPrecision {
  return Number.isFinite(uses) && uses >= ROUNDED_FROM && uses % 100 === 0 ? "rounded" : "exact";
}

/**
 * The reader's word when it has one -- Instagram's parser sees the "K" -- and
 * the value's own shape otherwise, which is every TikTok reader's case: the
 * embed, the browser and the worker all carry TikTok's rounding.
 */
export function readingPrecision(uses: number, reported?: UsesPrecision | null): UsesPrecision {
  return reported ?? usesPrecisionOf(uses);
}

/**
 * The place value of a rounded figure's last significant digit: 74,000 could be
 * anything from 73,500 up, 74,100 only within a hundred. Read off the figure
 * rather than off the platform's format, so it is never finer than the figure.
 */
export function roundingStep(uses: number): number {
  let step = 1;
  while (step < uses && uses % (step * 10) === 0) step *= 10;
  return step;
}

/**
 * True when writing `uses` would put a rounded figure in place of an exact one
 * that it does not contradict -- 74,000 after 73,912 says nothing new and loses
 * 88 videos of precision. A rounded figure that has moved past the exact one by
 * more than its own rounding step is new information and is written.
 */
export function roundedAddsNothing(
  previous: number | null | undefined,
  uses: number,
  precision: UsesPrecision,
): boolean {
  if (precision !== "rounded" || previous === null || previous === undefined) return false;
  if (usesPrecisionOf(previous) !== "exact") return false;
  return Math.abs(uses - previous) < roundingStep(uses);
}

export type SoundChange = {
  /** Whether the pair could say anything: two readings, both exact. */
  known: boolean;
  videosAdded24h: number;
  deltaUses24h: number;
  /** Percent change since the previous reading. */
  velocityScore: number;
};

/**
 * The change one reading records against the one before it -- the arithmetic
 * every sound writer stores. The columns are non-nullable, so an unknown change
 * is stored as zeros and `known` is false; readers do not trust those zeros,
 * they recompute from the levels with the same precision test.
 */
export function soundReadingChange(
  previous: number | null | undefined,
  uses: number,
  precision: UsesPrecision = usesPrecisionOf(uses),
): SoundChange {
  if (
    previous === null ||
    previous === undefined ||
    precision !== "exact" ||
    usesPrecisionOf(previous) !== "exact"
  ) {
    return { known: false, videosAdded24h: 0, deltaUses24h: 0, velocityScore: 0 };
  }
  const delta = uses - previous;
  return {
    known: true,
    // A count of new videos cannot be negative; the signed change keeps its sign.
    videosAdded24h: Math.max(0, Math.round(delta)),
    deltaUses24h: Math.round(delta),
    velocityScore: velocityBetween(previous, uses),
  };
}
