/**
 * The date axis of a views-over-time chart.
 *
 * The campaign Performance tab printed every tick as "Apr 11" with no year and
 * let Recharts choose how many to draw. On a campaign whose posts span 2010 to
 * 2026 that was 26 labels reading "Apr 11 Dec 7 Aug 11 Apr 11 Dec 7 ..." --
 * in order, but indistinguishable from out of order, because the same month and
 * day came round every year. The client report (app/(public)/share/[token])
 * already carried the year whenever its series crossed one and read fine
 * ("Sep 1 '10 ... Oct 10 '26"); this is that rule, plus a hard cap on how many
 * ticks are drawn and a sort, so no caller has to trust its input's order.
 *
 * Every date here is a "YYYY-MM-DD" day key in UTC (lib/analytics/viewsSeries).
 */
type Dated = { date: string };

/** A copy in calendar order. Day keys sort correctly as strings. */
export function sortByDate<T extends Dated>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

const at = (iso: string, opts: Intl.DateTimeFormatOptions) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });

/**
 * At most `max` ticks, evenly spaced, always including the first and last day.
 * Recharts' own thinning keeps whatever fits the width, which on a long series
 * is dozens of labels nobody can read.
 */
export function evenTicks(dates: readonly string[], max = 7): string[] {
  if (dates.length <= max) return [...dates];
  if (max < 2) return [dates[0]];
  const step = (dates.length - 1) / (max - 1);
  const out: string[] = [];
  for (let i = 0; i < max; i++) {
    const d = dates[Math.round(i * step)];
    if (out[out.length - 1] !== d) out.push(d);
  }
  return out;
}

export type ChartDateAxis = {
  /** Short tick text: "Oct 6", or "Oct 6 '26" when the series crosses a year. */
  tick: (iso: string) => string;
  /** Tooltip heading: carries the full year when the series crosses one. */
  label: (iso: string) => string;
  /** The capped tick positions, for the axis's `ticks` prop. */
  ticks: string[];
};

export function chartDateAxis(series: readonly Dated[], maxTicks = 7): ChartDateAxis {
  const sorted = sortByDate(series);
  const multiYear = new Set(sorted.map((row) => row.date.slice(0, 4))).size > 1;
  return {
    tick: (iso) =>
      multiYear ? `${at(iso, { month: "short", day: "numeric" })} '${iso.slice(2, 4)}` : at(iso, { month: "short", day: "numeric" }),
    label: (iso) =>
      at(iso, multiYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" }),
    ticks: evenTicks(
      sorted.map((row) => row.date),
      maxTicks,
    ),
  };
}
