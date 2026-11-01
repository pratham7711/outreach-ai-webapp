/**
 * Round ticks for a value axis.
 *
 * Recharts' default steps by twentieths of a power of ten, so a 2.5M stack got
 * ticks every 650K and compact labels rounded the third one, 1.95M, to "2M" --
 * a gridline labelled with a value it does not sit at. Its round-number mode
 * ("snap125") always rounds the step up and then pads to the tick count, which
 * drew the same stack on a 0-4M axis with its top third empty.
 *
 * Here zero is always a tick, every step is 1, 2, 2.5 or 5 x 10^n, and the
 * step is the smallest that marks the data in at most five intervals, so the
 * axis ends at the first round value above the data. Below zero only the ticks
 * the data reaches are drawn and the axis stops at the data's own floor: a
 * daily chart with one day down by a single view used to spend a whole step
 * (-50 under a 0-150 axis) on it. The axes it serves count views, so no step
 * is below 1.
 */

const STEPS = [1, 2, 2.5, 5];
const MAX_INTERVALS = 5;

/* Two decimals, where formatCompact keeps one: a 250K step's 1.25M tick read
   "1.3M" there. No tick here needs a third. */
const TICK = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
  trailingZeroDisplay: "stripIfInteger",
});

/** A tick's label, exact for every value niceTicks returns. */
export function formatTick(n: number): string {
  return Number.isFinite(n) ? TICK.format(n) : "0";
}

/** Ticks from 0 down to the last step inside `min`, and up to the first step at or above `max`; undefined when there is no range to mark. */
export function niceTicks(min: number, max: number): number[] | undefined {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return undefined;
  let magnitude = Math.max(1, 10 ** Math.floor(Math.log10((hi - lo) / MAX_INTERVALS)));
  for (; Number.isFinite(magnitude); magnitude *= 10) {
    for (const m of STEPS) {
      const step = m * magnitude;
      if (!Number.isInteger(step)) continue;
      const below = Math.floor(-lo / step + 1e-9);
      const above = Math.ceil(hi / step - 1e-9);
      if (below + above <= MAX_INTERVALS) {
        return Array.from({ length: below + above + 1 }, (_, i) => Number(((i - below) * step).toPrecision(12)));
      }
    }
  }
  return undefined;
}

/**
 * The YAxis props for those ticks, or none (Recharts' own) when there is
 * nothing to mark. The domain runs from the data's floor (0 unless it dips
 * below) to the top tick.
 */
export function niceAxis([min, max]: readonly [number, number]): { ticks: number[]; domain: [number, number] } | Record<string, never> {
  const ticks = niceTicks(min, max);
  return ticks ? { ticks, domain: [Math.min(0, min, ticks[0]), ticks[ticks.length - 1]] } : {};
}

/**
 * The lowest and highest value a stack reaches: per row, the sum of the
 * negative values and the sum of the positive ones, as Recharts stacks them
 * with stackOffset "sign". A missing or null value adds nothing.
 */
export function stackExtent<T extends object>(rows: readonly T[], keys: readonly (keyof T & string)[]): [number, number] {
  let min = 0;
  let max = 0;
  for (const row of rows) {
    let down = 0;
    let up = 0;
    for (const key of keys) {
      const v = Number(row[key] ?? 0);
      if (!Number.isFinite(v)) continue;
      if (v < 0) down += v;
      else up += v;
    }
    min = Math.min(min, down);
    max = Math.max(max, up);
  }
  return [min, max];
}
