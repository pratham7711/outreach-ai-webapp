/**
 * Which of OUR surfaces is the counterpart of which of THEIRS.
 *
 * Kept as an explicit table rather than inferred from a name, because the two
 * products do not agree on vocabulary: their "Settings > Account" is our
 * /settings/profile, and their campaign "Settings" sub-tab is our ?section=edit.
 * A fuzzy matcher would pair those silently and wrongly.
 *
 * Their campaign sub-tabs are captured against three data-volume fixtures; the
 * `reference` fixture is the one paired, because a 50-post screen and an empty
 * one are different layouts and only one of them can be the baseline. The other
 * two stay in the capture as the volume evidence.
 *
 * An id absent from this table is not an error -- it is a verdict:
 *   ours with no theirs  -> NO_REFERENCE   (we have screens they do not)
 *   theirs with no ours  -> MISSING_OURS   (they have screens we do not)
 */
export const PAIRS = {
  campaigns: "nav-campaigns",
  activations: "nav-activations",
  calendar: "nav-calendar",
  clients: "nav-clients",
  "fan-pages": "nav-fan-pages",
  discovery: "nav-discovery",
  creators: "nav-creators",
  lists: "nav-lists",
  payouts: "nav-payouts",
  requests: "nav-requests",
  recipients: "nav-recipients",
  connections: "nav-connections",

  "settings-general": "settings-general",
  "settings-team": "settings-team",
  "settings-notifications": "settings-notifications",
  "settings-integrations": "settings-integrations",
  "settings-account": "settings-profile",

  "campaign-reference-overview": "campaign-overview",
  "campaign-reference-creators": "campaign-creators",
  "campaign-reference-drafts": "campaign-drafts",
  "campaign-reference-posts": "campaign-posts",
  "campaign-reference-analytics": "campaign-analytics",
  "campaign-reference-financials": "campaign-financials",
  "campaign-reference-documents": "campaign-documents",
  "campaign-reference-settings": "campaign-edit",
};

/** Theirs with no counterpart of ours -- a gap in OUR product, not a failure. */
export const MISSING_OURS_NOTES = {
  "trackers-sound": "no sound-tracker screen in our app",
  "trackers-creator": "no creator-tracker screen in our app",
  "settings-branding": "branding lives in the white-label config, not a settings tab",
  "settings-stories": "no stories feature",
};
