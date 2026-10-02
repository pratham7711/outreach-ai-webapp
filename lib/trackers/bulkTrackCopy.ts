/**
 * What the Track buttons say, kept apart from lib/trackers/trackAll.ts so a
 * client component can import it without pulling the tracker switch -- and
 * with it the database client -- into the browser bundle.
 */

/** GET /api/trackers/creators/bulk. */
export type TrackStatus = {
  trackAllOpen: boolean;
  reason: string | null;
  /** How many a selection or a campaign may add while Track all is shut. */
  ungatedMax: number;
  /** Creators on the roster, tracked or not. */
  roster: number;
  untracked: number;
  /** Trackers in use, sounds included. */
  tracked: number;
  limit: number | null;
  roomLeft: number | null;
  limitMessage: string | null;
};

/** POST /api/trackers/creators/bulk. */
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
  tracked: number;
  notFound?: number;
  limitMessage: string | null;
};

const n = (v: number) => v.toLocaleString("en-US");

/** "Added 700 · already tracked 1,850 · room left 1,450" -- the toast. */
export function bulkTrackSummary(
  r: Pick<BulkTrackResult, "added" | "alreadyTracked" | "roomLeft" | "skippedForLimit">
): string {
  const parts = [`Added ${n(r.added)}`, `already tracked ${n(r.alreadyTracked)}`];
  if (r.skippedForLimit > 0) parts.push(`${n(r.skippedForLimit)} over the plan's limit`);
  if (r.roomLeft !== null) parts.push(`room left ${n(r.roomLeft)}`);
  return parts.join(" · ");
}
