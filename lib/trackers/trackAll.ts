import { inReaderV2Scope, type ResolvedTrackerPlan } from "./sourceSwitch";

/**
 * Track all, Track selected, Track this campaign's creators (plan §04, §12 F2/F3).
 *
 * Three doors onto one write, and one gate in front of the biggest of them.
 *
 * The gate exists because of what a tracked creator costs the reader rather
 * than what it costs the plan. The legacy sweep gets through a measured few
 * dozen creators a fire (snapshot.ts, SWEEP_CONCURRENCY), oldest attempt
 * first. An agency that adds 700 creators at once on that reader lengthens
 * every creator's gap between readings by the time those 700 take, and after
 * 24 hours unread the page stops showing a creator's changes (FRESH_WINDOW_MS).
 * So Track all opens only once reader v2 reads this whole workspace: the
 * switch is not on legacy, this org is in its scope, and the rollout is at
 * 100% -- at anything less, part of the agency's creators are still read by
 * the sweep the 700 would land on.
 *
 * New rows are stamped `trackerLastAttemptAt = now` for the same reason: the
 * sweep orders by that column ascending with nulls first, so an unstamped row
 * is the head of the queue, and 700 of them would be read before any creator
 * already tracked.
 */

/**
 * How many creators Track selected and Track this campaign's creators may add
 * while Track all is still closed.
 *
 * Twenty-five, because that is the starter plan's whole tracker allowance
 * (lib/plans.ts) -- the most an agency could ever have added one at a time
 * through the picker on the smallest paid plan -- and below what one fire of
 * the legacy sweep read even before it was pooled (~58 creators, measured;
 * see SWEEP_CONCURRENCY in lib/creators/snapshot.ts), so the rows it adds
 * are absorbed in one rotation rather than stretching it.
 *
 * It counts rows that would actually be ADDED, after the already-tracked and
 * the plan limit are taken out, so re-tracking a big campaign that is mostly
 * tracked already is not refused for its size.
 */
export const BULK_TRACK_UNGATED_MAX = 25;

export const TRACK_ALL_CLOSED =
  "Track all opens once the new reader runs for this workspace.";

export type TrackAllGate = { open: boolean; reason: string | null };

export function trackAllGate(plan: ResolvedTrackerPlan, orgId: string): TrackAllGate {
  if (plan.effective === "legacy") return { open: false, reason: TRACK_ALL_CLOSED };
  /* inReaderV2Scope answers per creator; at 100% the bucket test always
     passes, so asking it about the org is asking whether the org is in scope. */
  if (plan.percent < 100 || !inReaderV2Scope(plan, { id: orgId, orgId })) {
    return { open: false, reason: TRACK_ALL_CLOSED };
  }
  return { open: true, reason: null };
}

/** The sentence for a request that would add more than the ungated maximum. */
export function overUngatedMaxMessage(wouldAdd: number): string {
  return `That would add ${wouldAdd} creators. Until Track all opens for this workspace, add up to ${BULK_TRACK_UNGATED_MAX} at a time.`;
}

export type BulkTrackResult = {
  /** Creators the request covered, in this org. */
  requested: number;
  added: number;
  alreadyTracked: number;
  /** Not tracked because the plan's limit ran out. */
  skippedForLimit: number;
  /** After this request; null on a plan without a limit. */
  roomLeft: number | null;
  limit: number | null;
};

/** "Added 700 · already tracked 1,850 · room left 1,450" -- the toast. */
export function bulkTrackSummary(r: Pick<BulkTrackResult, "added" | "alreadyTracked" | "roomLeft" | "skippedForLimit">): string {
  const n = (v: number) => v.toLocaleString("en-US");
  const parts = [`Added ${n(r.added)}`, `already tracked ${n(r.alreadyTracked)}`];
  if (r.skippedForLimit > 0) parts.push(`${n(r.skippedForLimit)} over the plan's limit`);
  if (r.roomLeft !== null) parts.push(`room left ${n(r.roomLeft)}`);
  return parts.join(" · ");
}
