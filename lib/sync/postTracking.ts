import {
  DEFAULT_POST_TRACKING,
  POST_TTL_MAX_DAYS,
  POST_TTL_MIN_DAYS,
  READ_CADENCE_HOURS,
  clampTtlDays,
  postTrackingExpiry,
  type PostTrackingGranularity,
} from "@/lib/trackers/granularity";

export { POST_TTL_MAX_DAYS, POST_TTL_MIN_DAYS, clampTtlDays, postTrackingExpiry };

/**
 * Whether the cron reads a post this run, and on what grounds.
 *
 * This replaces the campaign-driven ladder in lib/sync/cadence.ts for the cron
 * path. The old model asked "is this campaign due, and how old is this post";
 * both halves were wrong for what the product now sells.
 *
 * The campaign half was wrong twice over, and it is worth being exact about
 * which half did the damage, because the obvious culprit is not the main one.
 * Measured on prod 2026-09-09, that gate's candidate set was 103 posts out of
 * 18,787 live ones. The dominant exclusion is the campaign STATUS filter: 497 of
 * ~500 campaigns are COMPLETE, and a COMPLETE campaign's posts were never swept
 * whatever their interval said. CreatorCore's 9999 = "never" sentinel sits on
 * top of that and turns out to be irrelevant for live campaigns -- counted both
 * ways, honouring it and ignoring it, the live untracked set is the same 102
 * posts, because no IN_PROGRESS campaign carries it.
 *
 * Both are gone now, and neither expressed a decision anyone made: the status
 * filter read "the campaign finished" as "nobody wants these numbers", and the
 * sentinel arrived with an importer.
 *
 * The post half was wrong because it keyed off `postedAt` -- a publish date has
 * no opinion about whether anyone still wants the numbers, which is how a
 * 180-day horizon came to be doing the job of a user preference.
 *
 * So the only thing that decides now is the tracker the user actually created:
 * it is on, it has not expired, and its cadence says it is due.
 */
export type PostTrackingAction = "sync" | "skip" | "seal";

export type PostTrackingDecision = { action: PostTrackingAction; reason: string };

export type PostTrackingInput = {
  trackingEnabled: boolean;
  trackingStartedAt: Date | null;
  /** The TTL end. Null on rows that predate the column — see effectiveExpiry. */
  trackingExpiresAt: Date | null;
  trackingTtlDays: number | null;
  lastSyncedAt: Date | null;
  /** When we last ASKED, from the __lastFetch stamp. A post that never measures
   *  must still be throttled, or it becomes the one row retried on every run. */
  lastAttemptAt?: Date | null;
  syncDisabledAt: Date | null;
  hasFinalSnapshot: boolean;
  granularity: PostTrackingGranularity;
  now: Date;
};

const HOUR_MS = 60 * 60 * 1000;
/* A cron that fires at 04:00:10 must not defer a 1-hourly post read at
   03:00:40 by a whole cycle. Five minutes absorbs Vercel's jitter and cannot
   double-read: the next run is ~55 minutes away, not five. */
const DUE_GRACE_MS = 5 * 60 * 1000;

/**
 * The expiry to enforce, including for rows written before the column existed.
 *
 * A tracked post with a null `trackingExpiresAt` is not treated as expired.
 * Sealing those on the first run after deploy would retire every currently
 * tracked post at once, permanently — the seal is one-way. It is read instead as
 * "started, TTL never recorded", and the org default is applied from whenever
 * tracking began. A tracker with neither timestamp is treated as starting now,
 * which gives it a full window rather than none.
 */
export function effectiveExpiry(input: PostTrackingInput): Date {
  if (input.trackingExpiresAt) return input.trackingExpiresAt;
  const from = input.trackingStartedAt ?? input.now;
  return postTrackingExpiry(
    from,
    clampTtlDays(input.trackingTtlDays, input.granularity.defaultTtlDays),
  );
}

export function decidePostTracking(input: PostTrackingInput): PostTrackingDecision {
  if (input.syncDisabledAt) return { action: "skip", reason: "dead-letter" };
  if (input.hasFinalSnapshot) return { action: "skip", reason: "sealed" };
  if (!input.trackingEnabled) return { action: "skip", reason: "not-tracked" };

  /* Expiry is checked before cadence, so a window that closed between runs
     seals on the next one rather than waiting for the post to come due. */
  if (input.now.getTime() >= effectiveExpiry(input).getTime()) {
    return { action: "seal", reason: "ttl-expired" };
  }

  /* The later of "last measured" and "last attempted". Answering "how long
     since we spent a request on this" with successes only made failure
     self-perpetuating: a post that never measures would never be throttled. */
  const lastTouchMs = Math.max(
    input.lastSyncedAt?.getTime() ?? -Infinity,
    input.lastAttemptAt?.getTime() ?? -Infinity,
  );
  if (lastTouchMs === -Infinity) return { action: "sync", reason: "never-read" };

  const dueAfterMs = READ_CADENCE_HOURS[input.granularity.readCadence] * HOUR_MS;
  if (input.now.getTime() - lastTouchMs >= dueAfterMs - DUE_GRACE_MS) {
    return { action: "sync", reason: `cadence-${input.granularity.readCadence}` };
  }
  return { action: "skip", reason: `cadence-throttle-${input.granularity.readCadence}` };
}

/** Remaining window, in whole hours, for the UI to show next to a tracker. */
export function hoursRemaining(input: PostTrackingInput): number {
  const ms = effectiveExpiry(input).getTime() - input.now.getTime();
  return ms <= 0 ? 0 : Math.ceil(ms / HOUR_MS);
}

export const POST_TRACKING_DEFAULTS = DEFAULT_POST_TRACKING;
