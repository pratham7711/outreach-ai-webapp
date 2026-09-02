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
  /**
   * When we last ASKED, as opposed to when we last succeeded.
   *
   * Every throttle below was written against lastSyncedAt, which
   * applyPostMetrics stamps only when counts actually arrive. So a post that
   * has never once measured has lastSyncedAt === null, reads as
   * lastSyncHours === Infinity, and clears every interval check ever -- it is
   * "due" on every single hourly run, forever. That is exactly the population
   * least likely to succeed, asked the most often, and it is how an unreadable
   * TikTok post used to reach five strikes in five hours.
   *
   * Sourced from the __lastFetch stamp that the no-counts branch already writes
   * to platformMetrics, so this costs no extra column and no extra query.
   */
  lastAttemptAt?: Date | null;
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
  /* The later of "last measured" and "last attempted". Every interval below is
     really asking "how long since we last spent a request on this post", and
     answering that with successes only made failure self-perpetuating: a post
     that never measures is never throttled, so it is retried every run while
     posts that work are politely spaced out. Taking the max keeps the intended
     meaning for healthy posts -- a success clears __lastFetch, so lastSyncedAt
     is the later one for them anyway. */
  const lastTouchMs = Math.max(
    input.lastSyncedAt?.getTime() ?? -Infinity,
    input.lastAttemptAt?.getTime() ?? -Infinity,
  );
  const lastSyncHours =
    lastTouchMs === -Infinity ? Infinity : (input.now.getTime() - lastTouchMs) / HOUR_MS;

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
