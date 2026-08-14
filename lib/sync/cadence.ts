import type { SyncSlotState } from "@/lib/syncSlot/state";

export type SyncAction = "sync" | "skip" | "seal";

export type SyncDecision = { action: SyncAction; reason: string };

export type SyncSlotContext = {
  state: SyncSlotState;
  hotUntil: Date | null;
};

export type SyncDecisionInput = {
  postedAt: Date;
  lastSyncedAt: Date | null;
  syncFailCount: number;
  syncDisabledAt: Date | null;
  hasFinalSnapshot: boolean;
  trackingEnabled: boolean;
  trackingStartedAt: Date | null;
  now: Date;
  slot?: SyncSlotContext | null;
  settlementClosesAt?: Date | null;
};

const HOUR_MS = 1000 * 60 * 60;
const TRACKING_WINDOW_HOURS = 72;

const HOT_INTERVAL_HOURS = 5 / 60;
const WARM_INTERVAL_HOURS = 1;
const COOLING_INTERVAL_HOURS = 6;
const SETTLEMENT_INTERVAL_HOURS = 24;

type SlotTier = "hot" | "warm" | "cooling" | null;

function slotTier(slot: SyncSlotContext | null | undefined, now: Date): SlotTier {
  if (!slot) return null;

  const hot = slot.hotUntil === null || now < slot.hotUntil;

  switch (slot.state) {
    case "ASSIGNED":
      return hot ? "hot" : "warm";
    case "PINNED":
      return hot ? "hot" : "warm";
    case "WARM":
      return "warm";
    case "COOLING":
      return "cooling";
    default:
      return null;
  }
}

const TIER_INTERVALS: Record<Exclude<SlotTier, null>, number> = {
  hot: HOT_INTERVAL_HOURS,
  warm: WARM_INTERVAL_HOURS,
  cooling: COOLING_INTERVAL_HOURS,
};

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

  const settlementOpen =
    input.settlementClosesAt != null && input.now < input.settlementClosesAt;

  if (ageHours > 30 * 24) {
    if (!settlementOpen) {
      return { action: "seal", reason: "age-over-30d" };
    }
    if (lastSyncHours >= SETTLEMENT_INTERVAL_HOURS) {
      return { action: "sync", reason: "settlement-daily" };
    }
    return { action: "skip", reason: "settlement-throttle" };
  }

  const tier = slotTier(input.slot, input.now);
  if (tier) {
    if (lastSyncHours >= TIER_INTERVALS[tier]) {
      return { action: "sync", reason: `slot-${tier}` };
    }
    return { action: "skip", reason: `slot-throttle-${tier}` };
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
