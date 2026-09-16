/**
 * What "do this to the posts I picked" means, in one place.
 *
 * The four actions here already existed one post at a time -- approve and
 * reject on PATCH .../posts/[postId], track and untrack on POST
 * .../posts/[postId]/track -- and the rule they have to keep is that a bulk
 * call cannot do anything the single call would refuse. So the row each action
 * writes is derived HERE, by a pure function, and both the route and its tests
 * read it from the same definition. A second copy inside the route handler is
 * exactly how "approve in bulk" would quietly stop clearing rejectionReason.
 *
 * Sync is deliberately NOT one of these. A subset sync needs the pacing,
 * resumption and progress reporting that campaigns/[id]/refresh already owns;
 * a loop here would fire fifty platform requests at once and report nothing
 * while it did. Bulk track enables the trackers and the sweep takes the first
 * reading -- or the operator presses Refresh Data and gets it now.
 */
import { clampTtlDays, postTrackingExpiry } from "@/lib/sync/postTracking";
import type { PostStatus } from "@/lib/generated/prisma/client";

/** The cap on one call. The same 50 the paste box uses, for the same reason:
 *  it is a number a person can still look at and understand what they did. */
export const MAX_BULK_ACTION_POSTS = 50;

export const BULK_ACTIONS = ["approve", "reject", "track", "untrack"] as const;
export type BulkAction = (typeof BULK_ACTIONS)[number];

export function isBulkAction(value: unknown): value is BulkAction {
  return typeof value === "string" && (BULK_ACTIONS as readonly string[]).includes(value);
}

export type BulkActionInput = {
  action: BulkAction;
  /** Only read by "track"; clamped against the org's configured default. */
  ttlDays?: number;
  /** Only read by "reject"; an empty string is stored as null, not "". */
  rejectionReason?: string | null;
  /** The org's default TTL, so a missing ttlDays never means "forever". */
  defaultTtlDays: number;
  /** Injected so the expiry a test asserts on is not the wall clock. */
  now: Date;
};

/** The exact column set each action writes. Prisma `data`, nothing else. */
export type BulkUpdateData = {
  status?: PostStatus;
  rejectionReason?: string | null;
  trackingEnabled?: boolean;
  trackingStartedAt?: Date | null;
  trackingTtlDays?: number | null;
  trackingExpiresAt?: Date | null;
};

export function bulkUpdateData(input: BulkActionInput): BulkUpdateData {
  const { action, now } = input;

  switch (action) {
    case "approve":
      /* Clearing the reason is not optional. A post rejected with "wrong
         product" and then approved keeps that sentence on the row otherwise,
         and the creator's portal still shows it -- which is precisely what the
         single-post PATCH is careful about. */
      return { status: "APPROVED" as PostStatus, rejectionReason: null };

    case "reject": {
      const reason = typeof input.rejectionReason === "string" ? input.rejectionReason.trim() : "";
      return { status: "REJECTED" as PostStatus, rejectionReason: reason === "" ? null : reason };
    }

    case "track": {
      const ttl = clampTtlDays(input.ttlDays ?? input.defaultTtlDays, input.defaultTtlDays);
      /* One `now` for the whole selection, so fifty posts tracked in one click
         share a start and an expiry. Re-tracking restarts the window rather
         than resuming it, matching the single-post route. */
      return {
        trackingEnabled: true,
        trackingStartedAt: now,
        trackingTtlDays: ttl,
        trackingExpiresAt: postTrackingExpiry(now, ttl),
      };
    }

    case "untrack":
      /* cost-guard: ok — these nulls END a tracker rather than making one
         perpetual. trackingEnabled is false in the same write, so the sweep
         stops selecting the post; leaving a stale expiry behind is what would
         cost something, by letting a re-enabled tracker inherit a window that
         has already passed. */
      return {
        trackingEnabled: false,
        trackingStartedAt: null,
        trackingTtlDays: null,
        trackingExpiresAt: null,
      };
  }
}

/**
 * What the operator is told afterwards.
 *
 * "42 posts updated" is not enough for track: the trackers are running but no
 * number on the page has moved yet, and the next sweep is up to six hours
 * away. Saying so here stops that reading as a failure.
 */
export function bulkActionSummary(action: BulkAction, count: number, ttlDays?: number): string {
  const posts = `${count} post${count === 1 ? "" : "s"}`;
  switch (action) {
    case "approve":
      return `Approved ${posts}.`;
    case "reject":
      return `Rejected ${posts}.`;
    case "track":
      return `Tracking ${posts} for ${ttlDays} day${ttlDays === 1 ? "" : "s"}. The first reading comes with the next sweep — press Refresh Data to take it now.`;
    case "untrack":
      return `Stopped tracking ${posts}.`;
  }
}
