// What a share link is allowed to show.
//
// CreatorCore's Share Campaign modal gates the report field by field, and the
// switches that matter are the commercial ones: an agency sending a link to a
// brand does not necessarily want that brand reading rates or budget. Ours was
// all-or-nothing.
//
// Only toggles that map onto something the report actually renders live here,
// which is why CreatorCore's list is not reproduced wholesale:
//
//   "Hide All Drafts"  — our shared report has no drafts section to hide. The
//                        columns exist on Activation (draftUrl, draftCaption,
//                        draftSubmittedAt) and 0 rows carry one, so the switch
//                        would control nothing.
//   "Show Reach"       — reachCount now HAS a writer: assemblePostMetrics used
//                        to parse reach off the Instagram insights edge and
//                        drop it before the write, and that whitelist gap is
//                        fixed. What is still missing is coverage. Every one of
//                        the 18,676 existing rows holds the column default,
//                        most of them carrying a lastSyncedAt from a sync that
//                        never asked for reach — so a tile added today would
//                        tell a brand a campaign with 12.9B views reached
//                        nobody. The per-metric provenance that distinguishes
//                        them exists (fieldMetricValue + __measured) and the
//                        post-detail card is gated on it; a share toggle waits
//                        until re-synced Instagram posts make the number
//                        non-empty for a whole campaign, because a switch whose
//                        report section is blank for every campaign is still a
//                        switch that controls nothing.
//   "Show Rates"       — we model a creator's rate card (Creator.rate, set on 12
//                        of 1,834) but not what a campaign agreed to pay them.
//                        Printing the card rate on a client-facing report under
//                        the heading "rate" would misstate the commercial terms.
//                        Needs an activation-level agreed rate, which belongs
//                        with the parked payments work.
//
// A switch that controls nothing, or that labels one number as another, is
// worse than an absent one.

/** The platforms the shared report can chart. Matches the report's own series. */
export const SHARE_PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE"] as const;
export type SharePlatform = (typeof SHARE_PLATFORMS)[number];

export type ShareVisibility = {
  /** Empty means "no restriction" — every platform counts, including ones outside SHARE_PLATFORMS. */
  platforms: SharePlatform[];
  /** The per-creator leaderboard. CreatorCore calls this "Hide All Creators". */
  showCreators: boolean;
  /** The campaign's total budget as a tile. */
  showBudget: boolean;
  /**
   * Each creator's activation status on this campaign. CreatorCore calls this
   * "Show Creator Statuses". Off by default: where a campaign is going, and who
   * declined, is agency-internal until someone decides otherwise.
   */
  showStatuses: boolean;
  /**
   * Whether a post the platform has stopped serving is flagged as such.
   *
   * Off by default, and that default is the whole point. The dashboard shows
   * removals because the agency has to chase them; a client report is a record
   * of what a campaign delivered, and a post's views were earned while it was
   * up whether or not the creator has since taken it down. Turning this on is a
   * deliberate act of disclosure, not the safe setting — so it fails closed the
   * same way budget and statuses do.
   */
  markRemovedPosts: boolean;
};

/**
 * What a link with no stored visibility shows.
 *
 * Everything except budget. Links created before this feature existed have only
 * `{kind}` in their config, and they have already been sent to people — so the
 * default has to be what those links currently render, or live links would
 * silently change behaviour under their recipients. Budget is the one exception:
 * it was never rendered at all, so including it here would be a leak rather
 * than continuity.
 */
export const DEFAULT_SHARE_VISIBILITY: ShareVisibility = {
  platforms: [],
  showCreators: true,
  showBudget: false,
  showStatuses: false,
  markRemovedPosts: false,
};

function isSharePlatform(v: unknown): v is SharePlatform {
  return typeof v === "string" && (SHARE_PLATFORMS as readonly string[]).includes(v);
}

/**
 * Reads visibility back out of Report.config.
 *
 * Absent entirely -> DEFAULT_SHARE_VISIBILITY, for the legacy-link reason above.
 * Present but with a field malformed -> that field falls to the *closed* value,
 * never the open one. A public link is the wrong place for a parser that fails
 * open, and `showBudget: "yes"` must not read as true.
 */
export function parseShareVisibility(raw: unknown): ShareVisibility {
  if (!raw || typeof raw !== "object") return DEFAULT_SHARE_VISIBILITY;
  const v = (raw as { visibility?: unknown }).visibility;
  if (!v || typeof v !== "object") return DEFAULT_SHARE_VISIBILITY;

  const o = v as Record<string, unknown>;
  return {
    platforms: Array.isArray(o.platforms) ? o.platforms.filter(isSharePlatform) : [],
    showCreators: o.showCreators === true,
    showBudget: o.showBudget === true,
    showStatuses: o.showStatuses === true,
    markRemovedPosts: o.markRemovedPosts === true,
  };
}

/**
 * Validates a visibility object arriving from the client before it is stored.
 * Unknown keys are dropped rather than persisted, so config stays a closed set.
 */
export function sanitizeShareVisibility(raw: unknown): ShareVisibility {
  if (!raw || typeof raw !== "object") return DEFAULT_SHARE_VISIBILITY;
  const o = raw as Record<string, unknown>;
  return {
    platforms: Array.isArray(o.platforms) ? [...new Set(o.platforms.filter(isSharePlatform))] : [],
    showCreators: o.showCreators !== false,
    showBudget: o.showBudget === true,
    showStatuses: o.showStatuses === true,
    markRemovedPosts: o.markRemovedPosts === true,
  };
}
