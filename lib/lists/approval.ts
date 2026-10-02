/**
 * A list's status is a consequence of its creators' decisions, not a field
 * someone sets by hand. Keeping the derivation in one place is what stops the
 * listing page, the detail page and the client-facing share link from each
 * answering "is this approved?" differently.
 *
 * It is derived on every read rather than stored: nothing is written when a
 * creator is added or removed or a link is shared, so there is no stored copy
 * to fall out of step. The one status that is not derived is ARCHIVED -- that
 * is a deliberate human act, kept on CreatorListDetail.archivedAt.
 *
 * Pure and free of `db`, so client components can import the counting and the
 * labels without pulling Prisma into the browser bundle.
 */

export type ListStatus = "DRAFT" | "SHARED" | "APPROVED" | "ARCHIVED";
export type ListItemDecision = "PENDING" | "APPROVED" | "REJECTED";

export const LIST_ITEM_DECISIONS: readonly ListItemDecision[] = ["PENDING", "APPROVED", "REJECTED"];

/** The stored column is free text; anything unrecognised reads as undecided. */
export function parseDecision(value: unknown): ListItemDecision {
  return value === "APPROVED" || value === "REJECTED" ? value : "PENDING";
}

export type DecisionCounts = {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
};

export const EMPTY_COUNTS: DecisionCounts = { total: 0, pending: 0, approved: 0, rejected: 0 };

export function countDecisions(items: { decision: ListItemDecision }[]): DecisionCounts {
  return items.reduce<DecisionCounts>(
    (acc, item) => {
      acc.total += 1;
      if (item.decision === "APPROVED") acc.approved += 1;
      else if (item.decision === "REJECTED") acc.rejected += 1;
      else acc.pending += 1;
      return acc;
    },
    { ...EMPTY_COUNTS },
  );
}

/**
 * The rollup itself.
 *
 * APPROVED means the client has finished: every creator has a verdict and at
 * least one of them is a yes. A list where the client declined everybody is
 * decided but is not an approved list -- duplicating it would produce nothing.
 * It stays SHARED. An empty list is never APPROVED.
 *
 * Falling back out of APPROVED is the case that matters: someone adds a creator
 * to an approved list, and it is a pending pitch again.
 */
export function rollupStatus(counts: DecisionCounts, opts: { archived: boolean; hasShareLink: boolean }): ListStatus {
  if (opts.archived) return "ARCHIVED";
  const decided = counts.total > 0 && counts.pending === 0;
  if (decided && counts.approved > 0) return "APPROVED";
  return opts.hasShareLink ? "SHARED" : "DRAFT";
}

/** Whether the Duplicate dialog can offer an "approved only" copy. */
export function isDuplicableFromApproval(status: ListStatus, counts: DecisionCounts) {
  return status === "APPROVED" || counts.approved > 0;
}

export const LIST_STATUS_LABELS: Record<ListStatus, string> = {
  DRAFT: "Draft",
  SHARED: "Awaiting client",
  APPROVED: "Approved",
  ARCHIVED: "Archived",
};

export const LIST_STATUS_BADGE: Record<ListStatus, "neutral" | "accent" | "success" | "warning"> = {
  DRAFT: "neutral",
  SHARED: "accent",
  APPROVED: "success",
  ARCHIVED: "warning",
};

export const DECISION_LABELS: Record<ListItemDecision, string> = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Declined",
};

export const DECISION_BADGE: Record<ListItemDecision, "neutral" | "success" | "danger"> = {
  PENDING: "neutral",
  APPROVED: "success",
  REJECTED: "danger",
};

/** A rate typed into a cell: blank clears it, anything else must be a sane amount. */
export const MAX_RATE = 10_000_000;

export function parseRateInput(value: unknown): { ok: true; rate: number | null } | { ok: false } {
  if (value === null) return { ok: true, rate: null };
  if (typeof value === "string") {
    const t = value.replace(/[$,\s]/g, "");
    if (!t) return { ok: true, rate: null };
    value = Number(t);
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_RATE) return { ok: false };
  return { ok: true, rate: Math.round(value * 100) / 100 };
}
