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
import { DEAD_LETTER_CLEARED } from "@/lib/sync/deadLetter";
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
  syncFailCount?: number;
  syncDisabledAt?: Date | null;
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
        /* Lifts a dead letter, as the single-post route does: otherwise the
           selection reads "tracked" while the sweep never selects it. See
           lib/sync/deadLetter. */
        ...DEAD_LETTER_CLEARED,
      };
    }

    case "untrack":
      /* cost-guard: ok — these nulls END a tracker rather than making one
         perpetual. trackingEnabled is false in the same write, so the sweep
         stops selecting the post. The expiry is set to now rather than
         cleared: it records that tracking was stopped, which is what keeps a
         post in its first month or in a running campaign from being read
         automatically anyway (trackingStopped in lib/sync/postTracking). A
         re-enabled tracker writes a fresh one, so nothing inherits it. */
      return {
        trackingEnabled: false,
        trackingStartedAt: null,
        trackingTtlDays: null,
        trackingExpiresAt: now,
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

/* ─── Remove from campaign ───────────────────────────────────────────────────

   Not one of BULK_ACTIONS: those are column writes the bulk route applies with
   one updateMany, and a removal has its own route (DELETE .../posts), its own
   confirmation, its own refusal and its own way back (POST .../posts/restore).
   It is a soft remove -- see lib/posts/removed. What the two share is the cap
   and the wording, which live here so the dialog, the toast and the route
   cannot disagree about what was asked for. */

/** The ids a remove call may act on: trimmed, de-duplicated, capped. Null when unusable. */
export function removablePostIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const ids = [...new Set(raw.filter((v): v is string => typeof v === "string").map((v) => v.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.length > MAX_BULK_ACTION_POSTS || ids.some((id) => id.length > 100)) return null;
  return ids;
}

/** The confirmation, naming how many posts go and what happens to their
 *  numbers. Shaped as ConfirmOptions (components/ds/ConfirmDialog). */
export function removeConfirmText(count: number): { title: string; description: string; confirmLabel: string } {
  const posts = `${count} post${count === 1 ? "" : "s"}`;
  return {
    title: `Remove ${posts} from this campaign?`,
    /* It used to say "This can't be undone" -- true of the hard delete it
       described. The post is now kept, so the dialog says how to get it back. */
    description:
      count === 1
        ? "The post and its views come out of this campaign's totals. You can undo this right after, or restore it later from Removed."
        : `These ${posts} and their views come out of this campaign's totals. You can undo this right after, or restore them later from Removed.`,
    confirmLabel: `Remove ${posts}`,
  };
}

/** What the operator is told afterwards. */
export function removePostsSummary(removed: number): string {
  return `Removed ${removed} post${removed === 1 ? "" : "s"} from this campaign.`;
}

/** The line under that summary, saying how to get them back. */
export function removePostsUndoHint(removed: number): string {
  return `Undo now, or restore ${removed === 1 ? "it" : "them"} later from Removed.`;
}

/** What the operator is told after a restore -- from the toast's Undo or the Removed view. */
export function restorePostsSummary(restored: number): string {
  return `Restored ${restored} post${restored === 1 ? "" : "s"} to this campaign.`;
}
