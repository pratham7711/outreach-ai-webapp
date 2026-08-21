// What a share link is allowed to show.
//
// CreatorCore's Share Campaign modal gates the report field by field, and the
// switches that matter are the commercial ones: an agency sending a link to a
// brand does not necessarily want that brand reading rates or budget. Ours was
// all-or-nothing.
//
// Only toggles that map onto something the report actually renders live here.
// CreatorCore also offers "Show Creator Statuses" and "Hide All Drafts"; our
// shared report has neither a status column nor a drafts section, so a switch
// for them would control nothing and is deliberately absent rather than
// present-and-inert.

/** The platforms the shared report can chart. Matches the report's own series. */
export const SHARE_PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE"] as const;
export type SharePlatform = (typeof SHARE_PLATFORMS)[number];

export type ShareVisibility = {
  /** Empty means "no restriction" — every platform counts, including ones outside SHARE_PLATFORMS. */
  platforms: SharePlatform[];
  /** The per-creator leaderboard. CreatorCore calls this "Hide All Creators". */
  showCreators: boolean;
  /** Earned media value, both the KPI tile and the leaderboard column. */
  showEmv: boolean;
  /** The campaign's total budget as a tile. */
  showBudget: boolean;
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
  showEmv: true,
  showBudget: false,
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
    showEmv: o.showEmv === true,
    showBudget: o.showBudget === true,
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
    showEmv: o.showEmv !== false,
    showBudget: o.showBudget === true,
  };
}
