export type SyncSlotState =
  | "POOL"
  | "ASSIGNED"
  | "WARM"
  | "COOLING"
  | "RELEASED"
  | "PINNED";

export const HOT_WINDOW_HOURS = 6;
export const WARM_WINDOW_HOURS = 72;
export const HARD_CEILING_HOURS = 30 * 24;
export const VELOCITY_RELEASE_THRESHOLD = 50;

const HOUR_MS = 1000 * 60 * 60;

export type SyncSlotTransitionInput = {
  state: SyncSlotState;
  assignedAt: Date | null;
  now: Date;
  velocityPerHour: number | null;
  velocityThreshold?: number;
  hardCeilingHours?: number;
};

export type SyncSlotTransition = {
  next: SyncSlotState;
  reason: string;
};

export function velocityPerHour(
  snapshots: { viewsCount: number; recordedAt: Date }[]
): number | null {
  if (snapshots.length < 2) return null;

  const ordered = [...snapshots].sort(
    (a, b) => a.recordedAt.getTime() - b.recordedAt.getTime()
  );
  const previous = ordered[ordered.length - 2];
  const latest = ordered[ordered.length - 1];

  const hours = (latest.recordedAt.getTime() - previous.recordedAt.getTime()) / HOUR_MS;
  if (hours <= 0) return null;

  return (latest.viewsCount - previous.viewsCount) / hours;
}

function shouldAdvance(
  ageHours: number,
  windowHours: number,
  velocity: number | null,
  threshold: number,
  ceilingHours: number
): boolean {
  if (ageHours >= ceilingHours) return true;
  if (ageHours < windowHours) return false;
  if (velocity === null) return true;
  return velocity < threshold;
}

export function decideSyncSlotTransition(
  input: SyncSlotTransitionInput
): SyncSlotTransition {
  const threshold = input.velocityThreshold ?? VELOCITY_RELEASE_THRESHOLD;
  const ceiling = input.hardCeilingHours ?? HARD_CEILING_HOURS;

  if (input.state === "PINNED") {
    return { next: "PINNED", reason: "pinned" };
  }
  if (input.state === "POOL" || input.state === "RELEASED") {
    return { next: input.state, reason: "not-assigned" };
  }
  if (!input.assignedAt) {
    return { next: input.state, reason: "missing-assigned-at" };
  }

  const ageHours = (input.now.getTime() - input.assignedAt.getTime()) / HOUR_MS;

  if (input.state === "ASSIGNED") {
    if (shouldAdvance(ageHours, HOT_WINDOW_HOURS, input.velocityPerHour, threshold, ceiling)) {
      return { next: "WARM", reason: ageHours >= ceiling ? "hard-ceiling" : "hot-window-elapsed" };
    }
    return { next: "ASSIGNED", reason: "hot" };
  }

  if (input.state === "WARM") {
    if (shouldAdvance(ageHours, WARM_WINDOW_HOURS, input.velocityPerHour, threshold, ceiling)) {
      return { next: "COOLING", reason: ageHours >= ceiling ? "hard-ceiling" : "warm-window-elapsed" };
    }
    return { next: "WARM", reason: "warm" };
  }

  if (ageHours >= ceiling) {
    return { next: "RELEASED", reason: "hard-ceiling" };
  }
  if (input.velocityPerHour !== null && input.velocityPerHour >= threshold) {
    return { next: "COOLING", reason: "still-earning" };
  }
  return { next: "RELEASED", reason: "velocity-below-threshold" };
}

export type RerollCandidate = {
  postId: string;
  predictedValue: number;
};

export function pickRerollTarget(candidates: RerollCandidate[]): RerollCandidate | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, candidate) =>
    candidate.predictedValue > best.predictedValue ? candidate : best
  );
}

export function pinCap(poolSize: number, ratio = 0.2): number {
  if (poolSize <= 0) return 0;
  return Math.max(1, Math.floor(poolSize * ratio));
}

export function canPin(poolSize: number, currentlyPinned: number, ratio = 0.2): boolean {
  return currentlyPinned < pinCap(poolSize, ratio);
}
