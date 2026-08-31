export type TrackerSnapshot = {
  value: number;
  recordedAt: Date;
};

export type TrackerStatus = "viral" | "trending" | "stable" | "declining" | "unknown";

export type TrackerWindow = "24h" | "7d" | "14d" | "30d";

export const TRACKER_WINDOWS: TrackerWindow[] = ["24h", "7d", "14d", "30d"];

const HOUR_MS = 1000 * 60 * 60;

const WINDOW_HOURS: Record<TrackerWindow, number> = {
  "24h": 24,
  "7d": 7 * 24,
  "14d": 14 * 24,
  "30d": 30 * 24,
};

export function isTrackerWindow(value: string): value is TrackerWindow {
  return (TRACKER_WINDOWS as readonly string[]).includes(value);
}

/**
 * Whether a tracker's numbers are still worth believing.
 *
 * This is a separate question from what the numbers say, and conflating the two
 * is what produced the bug this exists to fix. "Wherever I Go" was read five
 * times in one hour on 22 August and never again. Nine days later the page still
 * reported `stable, +0 / 24hr (+0.0%)` — because `changeOverWindow` finds no
 * snapshot inside a 24-hour window, falls back to the second-newest reading of
 * all time, and subtracts two identical nine-day-old numbers. Zero change, zero
 * velocity, and `statusFor(0)` is "stable". Every step is behaving as written;
 * the composition is a lie. Worse, the delta was labelled "/ 24hr" while the
 * two readings it came from were sixty seconds apart.
 *
 * A count and its age are one fact. Trend answers "what is it doing", health
 * answers "can we still see it", and the UI must render them in separate slots
 * so a genuine decline is never mistaken for a dead reader.
 */
export type ReadHealth = "pending" | "live" | "regressed" | "stale";

/**
 * How old the newest reading may be before a number stops being current.
 *
 * The reader's timer is four-hourly, so this allows six consecutive misses
 * before the UI stops showing a live delta — late enough that one skipped run
 * is not an alarm, soon enough that a stopped reader cannot masquerade as calm
 * for nine days.
 *
 * Deliberately distinct from the ingest route's 30-day LIVE_WINDOW_MS, which
 * answers a different question: that one separates "an outage worth shouting
 * about" from "a row nobody has tracked in a month". One threshold cannot serve
 * both "is this current?" (hours) and "is this abandoned?" (weeks).
 */
export const FRESH_WINDOW_MS = 24 * HOUR_MS;
export const ABANDONED_WINDOW_MS = 30 * 24 * HOUR_MS;

export function readHealthFor(
  lastReadAt: Date | null,
  now: Date
): ReadHealth {
  if (!lastReadAt) return "pending";
  const age = now.getTime() - lastReadAt.getTime();
  // A clock skew that puts the reading in the future is still a live reading;
  // treating a negative age as stale would blank the page over a second's drift.
  if (age < FRESH_WINDOW_MS) return "live";
  if (age < ABANDONED_WINDOW_MS) return "regressed";
  return "stale";
}

/**
 * True only when a signed delta may be shown to a user.
 *
 * The guard belongs here rather than in the component so that every surface —
 * row, tile, detail chart, campaign audio card — agrees on when a number is
 * presentable, instead of each re-deriving it and one of them forgetting.
 */
export function isMeasurable(health: ReadHealth): boolean {
  return health === "live";
}

export function windowHours(window: TrackerWindow): number {
  return WINDOW_HOURS[window];
}

function ascending(snapshots: TrackerSnapshot[]): TrackerSnapshot[] {
  return [...snapshots].sort((a, b) => a.recordedAt.getTime() - b.recordedAt.getTime());
}

export function deltaFrom(
  previous: TrackerSnapshot | null,
  latest: TrackerSnapshot | null
): number | null {
  if (!previous || !latest) return null;
  return latest.value - previous.value;
}

export function velocityPerHour(
  previous: TrackerSnapshot | null,
  latest: TrackerSnapshot | null
): number | null {
  if (!previous || !latest) return null;
  const hours = (latest.recordedAt.getTime() - previous.recordedAt.getTime()) / HOUR_MS;
  if (hours <= 0) return null;
  return (latest.value - previous.value) / hours;
}

export type WindowChange = {
  from: number;
  to: number;
  added: number;
  percent: number | null;
  velocityPerHour: number | null;
  spanHours: number;
};

export function changeOverWindow(
  snapshots: TrackerSnapshot[],
  window: TrackerWindow,
  now: Date
): WindowChange | null {
  if (snapshots.length === 0) return null;

  const ordered = ascending(snapshots);
  const latest = ordered[ordered.length - 1];
  const cutoff = new Date(now.getTime() - windowHours(window) * HOUR_MS);

  const inWindow = ordered.filter((s) => s.recordedAt >= cutoff);
  const baseline =
    inWindow.length >= 2
      ? inWindow[0]
      : ordered.length >= 2
        ? ordered[ordered.length - 2]
        : null;

  if (!baseline || baseline === latest) return null;

  const spanHours = (latest.recordedAt.getTime() - baseline.recordedAt.getTime()) / HOUR_MS;
  const added = latest.value - baseline.value;

  return {
    from: baseline.value,
    to: latest.value,
    added,
    percent: baseline.value > 0 ? (added / baseline.value) * 100 : null,
    velocityPerHour: spanHours > 0 ? added / spanHours : null,
    spanHours,
  };
}

export function statusFor(velocityPerHour: number | null): TrackerStatus {
  if (velocityPerHour === null) return "unknown";
  if (velocityPerHour < 0) return "declining";
  if (velocityPerHour >= 100) return "viral";
  if (velocityPerHour >= 10) return "trending";
  return "stable";
}

// Growth between two consecutive snapshots, as a percentage, stored on each
// snapshot as velocityScore when it is recorded.
export function velocityBetween(prev: number, current: number): number {
  if (prev > 0) return Math.round(((current - prev) / prev) * 10000) / 100;
  return current > 0 ? 100 : 0;
}

export function latestOf(snapshots: TrackerSnapshot[]): TrackerSnapshot | null {
  if (snapshots.length === 0) return null;
  return ascending(snapshots)[snapshots.length - 1];
}

export function previousOf(snapshots: TrackerSnapshot[]): TrackerSnapshot | null {
  if (snapshots.length < 2) return null;
  const ordered = ascending(snapshots);
  return ordered[ordered.length - 2];
}
