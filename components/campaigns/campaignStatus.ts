/**
 * A campaign's status as words, one spelling for the list row, the detail
 * header and the Settings select.
 *
 * The three had drifted: "In-Progress" on the list, "In Progress" in the
 * header, "Cancelled" in the header against "Canceled" on the list's tab.
 * Sentence case, as every other badge reads (enumLabel), and the US
 * "Canceled" the status tab already uses.
 */
export const CAMPAIGN_STATUS_TEXT: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
  CANCELLED: "Canceled",
};

/** The statuses a campaign can be set to. DRAFT is not offered; see lib/campaigns/statusDefaults. */
export const CAMPAIGN_STATUS_OPTIONS = ["PENDING", "IN_PROGRESS", "COMPLETE", "CANCELLED"].map((value) => ({
  value,
  label: CAMPAIGN_STATUS_TEXT[value],
}));

export function campaignStatusText(status: string | null | undefined): string {
  if (!status) return "";
  return CAMPAIGN_STATUS_TEXT[status] ?? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, " ");
}
