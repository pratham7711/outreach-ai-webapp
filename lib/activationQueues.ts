/**
 * Activations as grouped queues rather than one flat board.
 *
 * CreatorCore groups its Activations list into named queues with a per-group
 * count and a per-group action pair, and that grouping is the point: it answers
 * "what needs doing" without the reader scanning statuses. See
 * docs/CREATORCORE_PARITY_PRD.md §5.
 *
 * The reference's own four groups are `Pending`, `Invited`,
 * `In-Progress - Empty Deliverables` and `Complete — Awaiting Payout`. Two of
 * those cannot be reproduced honestly. We have no invite/accept step on an
 * activation, so `Invited` has no state to hold; and `Empty Deliverables`
 * counts deliverables we do not model per activation. Rather than render two
 * groups that would always be empty, these queues follow the state machine we
 * actually have, in the same shape: named, counted, ordered by what is waiting
 * on whom.
 *
 * Order matters -- it runs from "waiting on the creator" through "waiting on
 * us" to terminal, so the top of the page is the work.
 */
export const ACTIVATION_QUEUES = [
  {
    key: "pending",
    label: "Pending",
    hint: "Waiting on the creator to submit a draft",
    statuses: ["AWAITING_DRAFT"],
  },
  {
    key: "review",
    label: "In Review",
    hint: "Draft submitted, waiting on your approval",
    statuses: ["DRAFT_SUBMITTED", "AWAITING_APPROVAL"],
  },
  {
    key: "revision",
    label: "Declined & Awaiting Revision",
    hint: "Sent back to the creator",
    statuses: ["DECLINED"],
  },
  {
    key: "progress",
    label: "In Progress",
    hint: "Approved through posted",
    statuses: ["APPROVED", "POSTING", "POSTED"],
  },
  {
    key: "complete",
    // The reference calls this "Complete — Awaiting Payout". Payouts are parked,
    // so this is a terminal state here with no payout affordance rather than a
    // queue implying an action nobody can take.
    label: "Complete",
    hint: "Nothing further outstanding",
    statuses: ["COMPLETE"],
  },
] as const;

export type ActivationQueueKey = (typeof ACTIVATION_QUEUES)[number]["key"];

/** The four stage counters across the top, matching the reference's headline row. */
export const ACTIVATION_STAGE_COUNTERS = [
  { label: "Awaiting Draft", statuses: ["AWAITING_DRAFT"] },
  { label: "Awaiting Approval", statuses: ["DRAFT_SUBMITTED", "AWAITING_APPROVAL"] },
  { label: "Declined & Awaiting Revision", statuses: ["DECLINED"] },
  { label: "Awaiting Posting", statuses: ["APPROVED"] },
] as const;

const QUEUE_OF_STATUS = new Map<string, ActivationQueueKey>();
for (const q of ACTIVATION_QUEUES) {
  for (const s of q.statuses) QUEUE_OF_STATUS.set(s, q.key);
}

/**
 * Which queue a status belongs to, or null if it belongs to none.
 *
 * Null rather than a default bucket on purpose: silently filing an unrecognised
 * status under "Pending" is how a new ActivationStatus would appear to be
 * handled while being mis-reported. Callers surface the leftovers instead.
 */
export function queueForStatus(status: string): ActivationQueueKey | null {
  return QUEUE_OF_STATUS.get(status) ?? null;
}

/** Groups rows by queue, preserving input order, plus anything unclaimed. */
export function groupByQueue<T extends { status: string }>(rows: readonly T[]) {
  const groups = new Map<ActivationQueueKey, T[]>();
  for (const q of ACTIVATION_QUEUES) groups.set(q.key, []);
  const ungrouped: T[] = [];

  for (const row of rows) {
    const key = queueForStatus(row.status);
    if (key === null) ungrouped.push(row);
    else groups.get(key)!.push(row);
  }
  return { groups, ungrouped };
}

export function countByStatuses<T extends { status: string }>(
  rows: readonly T[],
  statuses: readonly string[]
): number {
  return rows.filter((r) => statuses.includes(r.status)).length;
}
