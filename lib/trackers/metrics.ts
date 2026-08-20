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
