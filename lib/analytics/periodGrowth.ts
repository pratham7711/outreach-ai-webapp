/**
 * How far the account's total views moved in a window, beside the same-length
 * window before it. The total also moves when posts are added or removed, so
 * the screen names it "Change in total views" and always shows its two days.
 *
 * Read off the daily lifetime total (OrgViewsSnapshot), not off posts posted in
 * the window: a post from last month has had a month longer to collect views
 * than one from this month, so "views on posts posted in each window" would
 * always flatter the older one. The difference of the daily total is views
 * that arrived in the window, whichever post they landed on.
 *
 * A window is only reported when a reading exists at or before its start and
 * after it; a gap is null rather than a guess, and so is the change when the
 * earlier window gained nothing.
 */

export type DailyTotal = { day: Date | string; viewsCount: number };
export type PeriodGrowth = {
  days: number;
  current: number;
  previous: number | null;
  /** current vs previous as a fraction (0.12 = +12%); null without a previous window. */
  change: number | null;
  /** The two readings the current figure is the difference of, ISO days. */
  from: string;
  to: string;
};

const DAY = 86_400_000;
const dayMs = (d: Date | string) => {
  const t = new Date(d).getTime();
  return Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth(), new Date(t).getUTCDate());
};

/** The newest reading on or before `atMs`, by day. */
function readingAt(rows: { ms: number; views: number }[], atMs: number) {
  let best: { ms: number; views: number } | null = null;
  for (const r of rows) if (r.ms <= atMs && (!best || r.ms > best.ms)) best = r;
  return best;
}

/** The newest reading may be at most this old; past it the tile would show an old window as current. */
export const GROWTH_MAX_AGE_DAYS = 2;

export function viewsGrowth(totals: readonly DailyTotal[], days: number, nowMs?: number): PeriodGrowth | null {
  if (!(days > 0) || totals.length < 2) return null;
  const rows = totals.map((t) => ({ ms: dayMs(t.day), views: t.viewsCount })).sort((a, b) => a.ms - b.ms);
  const end = rows[rows.length - 1];
  /* The daily reading stopping must not leave an old window on screen
     looking current. */
  if (nowMs !== undefined && dayMs(new Date(nowMs)) - end.ms > GROWTH_MAX_AGE_DAYS * DAY) return null;
  /* Measured from the newest reading back, not from now: the total is taken
     once a day, so "the last 30 days" ends at the last reading. */
  const startMs = end.ms - days * DAY;
  const start = readingAt(rows, startMs);
  /* A start reading more than a day older than the window's start would fold
     earlier growth into this window. */
  if (!start || startMs - start.ms > DAY) return null;
  const current = end.views - start.views;
  const prevStart = readingAt(rows, startMs - days * DAY);
  const previous = prevStart && startMs - days * DAY - prevStart.ms <= DAY ? start.views - prevStart.views : null;
  const change = previous !== null && previous > 0 ? current / previous - 1 : null;
  return {
    days,
    current,
    previous,
    change,
    from: new Date(start.ms).toISOString().slice(0, 10),
    to: new Date(end.ms).toISOString().slice(0, 10),
  };
}

/** The tile's delta: the change in whole percent and what it is against. */
/** A count beside the same count over the window before; nothing when the earlier window had none. */
export function countDelta(
  current: number,
  previous: number | null | undefined,
  label: string,
): { value: string; trend: "up" | "down" | "flat"; label: string } | undefined {
  if (previous == null || !(previous > 0) || !Number.isFinite(current)) return undefined;
  const pct = Math.round(((current - previous) / previous) * 100);
  return { value: `${pct > 0 ? "+" : ""}${pct}%`, trend: pct > 0 ? "up" : pct < 0 ? "down" : "flat", label };
}

export function growthDelta(g: PeriodGrowth): { value: string; trend: "up" | "down" | "flat"; label: string } | undefined {
  if (g.change === null) return undefined;
  const pct = Math.round(g.change * 100);
  return {
    value: `${pct > 0 ? "+" : ""}${pct}%`,
    trend: pct > 0 ? "up" : pct < 0 ? "down" : "flat",
    label: `vs the ${g.days} days before`,
  };
}
