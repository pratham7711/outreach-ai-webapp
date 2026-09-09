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
   * "due" on every single run, forever. That is exactly the population least
   * likely to succeed, asked the most often, and it is how an unreadable
   * TikTok post used to reach five strikes in five runs.
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
/**
 * The boost a freshly tracked post gets, in hours between reads.
 *
 * This was 1 -- an hourly re-read for the first 72 hours, so 72 reads per
 * tracked post. Since 2026-09-09 nothing is read hourly: six hours is the
 * floor everywhere, the cron only fires every six hours, and asking for an
 * hourly sync here could not have been honoured anyway. 72h at six-hourly is
 * 12 reads, not 72.
 *
 * It stays a separate constant from the tracker cadences in
 * lib/trackers/granularity.ts because it answers a different question: that
 * one is the org's standing preference, this is the fixed boost every tracked
 * post gets while it is new.
 */
const TRACKING_BOOST_HOURS = 6;

/**
 * How old a post gets before its numbers are sealed and it leaves the sweep
 * for good.
 *
 * This was 30 days, and 30 days was wrong in a way that only shows up in
 * production data. The seal is measured from `postedAt` -- the publish date --
 * with no reference to whether anyone still cares about the campaign, and it
 * is one-way: sealing writes an `isFinalSnapshot` row, and the cron's candidate
 * query excludes `snapshots: { none: { isFinalSnapshot: true } }` permanently.
 * Nothing in this codebase ever removes one.
 *
 * The sweep only ever looks at campaigns that are `IN_PROGRESS` or `PENDING`,
 * so every post reaching this decision belongs to a campaign someone still has
 * open. A 30-day publish-date horizon therefore closed posts *inside running
 * campaigns*: a campaign that runs 60 days lost its early posts halfway
 * through, while still live, and they never came back. Measured in prod on
 * 2026-09-06, that had sealed 57 of 169 live posts -- including 35 of the 46
 * YouTube posts in one campaign, which is the whole reason YouTube had gone
 * dark. The platform correlation was a coincidence of age, not a fetcher bug.
 *
 * 180 days is a terminus, not an absence of one. Past 30 days a post falls
 * through to the `cadence-over-7d` rung below and is read once a day rather than
 * hourly, so the extra cost of the longer horizon is bounded and small: 53 of
 * the 169 live posts sit in the freed 30-180d band, which is ~2.2 reads/hour.
 * The bound matters -- a campaign left open forever must not sweep forever --
 * and 180 days is comfortably longer than any campaign in this data while
 * still guaranteeing every post eventually stops costing anything.
 */
export const SEAL_AGE_HOURS = 180 * 24;

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

  if (ageHours > SEAL_AGE_HOURS) {
    if (!settlementOpen) {
      return { action: "seal", reason: "age-over-180d" };
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
      if (lastSyncHours >= TRACKING_BOOST_HOURS) {
        return { action: "sync", reason: "tracking-boost" };
      }
      return { action: "skip", reason: "tracking-throttle" };
    }
  }

  /* Named for its lower bound only. It used to be the 7-30d band because the
     seal took everything past 30 days; with SEAL_AGE_HOURS at 180 days this
     rung now catches everything from 7 to 180, which is where the bulk of a
     live campaign's posts sit. A label that still said "7-30d" would be the
     fourth signal tonight that reads as one thing and means another. */
  if (ageHours > 7 * 24 && lastSyncHours < 24) {
    return { action: "skip", reason: "cadence-over-7d" };
  }
  if (ageHours > 24 && lastSyncHours < 6) {
    return { action: "skip", reason: "cadence-1-7d" };
  }

  return { action: "sync", reason: "due" };
}
