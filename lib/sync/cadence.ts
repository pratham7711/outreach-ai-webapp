export type SyncAction = "sync" | "skip" | "seal";

export type SyncDecision = { action: SyncAction; reason: string };

export type SyncDecisionInput = {
  postedAt: Date;
  lastSyncedAt: Date | null;
  syncFailCount: number;
  syncDisabledAt: Date | null;
  hasFinalSnapshot: boolean;
  trackingEnabled: boolean;
  trackingStartedAt: Date | null;
  now: Date;
};

const HOUR_MS = 1000 * 60 * 60;
const TRACKING_WINDOW_HOURS = 72;

export function decideSyncAction(input: SyncDecisionInput): SyncDecision {
  if (input.syncDisabledAt) {
    return { action: "skip", reason: "dead-letter" };
  }
  if (input.hasFinalSnapshot) {
    return { action: "skip", reason: "sealed" };
  }

  const ageHours = (input.now.getTime() - input.postedAt.getTime()) / HOUR_MS;
  const lastSyncHours = input.lastSyncedAt
    ? (input.now.getTime() - input.lastSyncedAt.getTime()) / HOUR_MS
    : Infinity;

  if (ageHours > 30 * 24) {
    return { action: "seal", reason: "age-over-30d" };
  }

  if (input.trackingEnabled && input.trackingStartedAt) {
    const trackingHours = (input.now.getTime() - input.trackingStartedAt.getTime()) / HOUR_MS;
    if (trackingHours < TRACKING_WINDOW_HOURS) {
      if (lastSyncHours >= 1) {
        return { action: "sync", reason: "tracking-hourly" };
      }
      return { action: "skip", reason: "tracking-throttle" };
    }
  }

  if (ageHours > 7 * 24 && lastSyncHours < 24) {
    return { action: "skip", reason: "cadence-7-30d" };
  }
  if (ageHours > 24 && lastSyncHours < 6) {
    return { action: "skip", reason: "cadence-1-7d" };
  }
  return { action: "sync", reason: "due" };
}
