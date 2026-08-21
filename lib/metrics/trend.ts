export type TrendDirection = "up" | "down" | "flat";

export type PeriodDelta = {
  value: string;
  trend: TrendDirection;
  label: string;
  isGood: boolean;
};

/**
 * Splits a chronological series in half and compares the two halves.
 *
 * Returns null when there is not enough history to make an honest comparison —
 * the caller then renders nothing rather than a "0%" that reads like a real
 * measurement. Same reason `formatMetric` prints "—" instead of 0.
 */
export function periodDelta(
  series: number[],
  opts: { higherIsBetter?: boolean; label?: string } = {},
): PeriodDelta | null {
  const { higherIsBetter = true, label = "vs previous period" } = opts;
  if (series.length < 4) return null;

  const mid = Math.floor(series.length / 2);
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const previous = sum(series.slice(0, mid));
  const current = sum(series.slice(mid));

  // No baseline means any change is undefined, not infinite.
  if (previous === 0) return null;

  const pct = ((current - previous) / previous) * 100;
  if (!Number.isFinite(pct)) return null;

  const trend: TrendDirection = Math.abs(pct) < 0.05 ? "flat" : pct > 0 ? "up" : "down";
  // Direction and tone are separate: pending payouts climbing is a rise, not a win.
  const isGood = trend === "flat" ? true : higherIsBetter ? pct > 0 : pct < 0;

  return {
    value: `${pct > 0 ? "+" : ""}${pct.toFixed(1)}%`,
    trend,
    label,
    isGood,
  };
}

/**
 * A metric that was never measured is not zero. Anything unmeasurable prints an
 * em dash so a reader can tell "we did not collect this" from "this is zero".
 */
export function formatMetric(
  value: number | null | undefined,
  format: (n: number) => string,
): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return format(value);
}

/** Cost per thousand views, or null when there is nothing to divide by. */
export function cpm(spend: number, views: number): number | null {
  if (!Number.isFinite(spend) || !Number.isFinite(views) || views <= 0) return null;
  return (spend / views) * 1000;
}
