/**
 * CreatorCore's status palette, read off the running app rather than guessed.
 *
 * The rule there is consistent: a status chip is a full pill whose background
 * is its own foreground colour at 12.5% alpha. There is exactly one deliberate
 * exception -- Active -- which is a solid blue with white text, so the
 * campaigns that are actually running are the ones that stand out in a list.
 * Reproducing that exception is most of why our statuses read differently: we
 * had Active as another pale tint, so nothing carried any weight.
 *
 * Captured with scripts/creatorcore/cc-badge-colors.mjs.
 */

export type StatusStyle = { bg: string; color: string };

/**
 * The one place a campaign status becomes words.
 *
 * There were five of these maps and three different spellings of the same
 * state: a card said "In Progress", the campaigns filter said "In-Progress",
 * the settings dropdown and the list tab said "Active", and the shared report
 * said "In-Progress" with a comment explaining that the reference app spells it
 * that way. So the same campaign changed status-name depending on which screen
 * you were looking at.
 *
 * "In-Progress" and "Canceled" are the reference's spellings, recorded in
 * docs/CREATORCORE_PARITY_PRD.md: the status control on a campaign renders
 * `In-Progress`, and the pills spell it `Canceled` with one L.
 *
 * This is the label for a campaign's own status. The FILTER PILLS on the
 * campaigns list are deliberately not this: the reference labels those
 * `All · Pending · Active · Complete · Canceled`, calling the same state
 * "Active" when it is a thing you filter by and "In-Progress" when it is a
 * thing a campaign is. Both are copied on purpose -- do not "fix" one into the
 * other. The prose further down this file also says "Active" as shorthand for
 * the solid-blue exception; that is a note about colour, not a label.
 */
export const CAMPAIGN_STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  PENDING: "Pending",
  IN_PROGRESS: "In-Progress",
  COMPLETE: "Complete",
  CANCELLED: "Canceled",
};

/** Falls back to the enum with underscores softened, never to a blank chip. */
export function campaignStatusLabel(status: string): string {
  return CAMPAIGN_STATUS_LABEL[status] ?? status.replace(/_/g, " ");
}

/** Campaign statuses, as the reference's list shows them. */
export const CAMPAIGN_STATUS_STYLE: Record<string, StatusStyle> = {
  ALL: { bg: "#F3F4F6", color: "#374151" },
  PENDING: { bg: "rgba(249, 204, 71, 0.125)", color: "#E7AD00" },
  IN_PROGRESS: { bg: "#3B75F2", color: "#FFFFFF" },
  COMPLETE: { bg: "rgba(86, 186, 87, 0.125)", color: "#56BA57" },
  CANCELLED: { bg: "rgba(255, 0, 0, 0.125)", color: "#FF0000" },
  // The reference's list has no Draft chip to sample, so this is the same rule
  // applied to a neutral rather than an invention of a new one.
  DRAFT: { bg: "rgba(107, 114, 128, 0.125)", color: "#6B7280" },
};

/**
 * Activation statuses -- Awaiting Draft, Awaiting Approval, Awaiting Posting.
 * These do not follow the tint rule: the reference gives all three the same
 * blue on the same pale ground, because which one it is matters less than that
 * something is waiting.
 */
export const ACTIVATION_STATUS_STYLE: StatusStyle = { bg: "#F0F3FC", color: "#1F3CEF" };

/** A status chip is a full pill; an activation chip is only mostly round. */
export const STATUS_PILL_RADIUS = 50;
export const ACTIVATION_PILL_RADIUS = 15;

export function campaignStatusStyle(status: string): StatusStyle {
  return CAMPAIGN_STATUS_STYLE[status] ?? CAMPAIGN_STATUS_STYLE.DRAFT;
}

/**
 * The same colours as a React style object.
 *
 * `bg` is not a CSS property, so spreading a StatusStyle straight into
 * `style={{ ... }}` sets the text colour and silently drops the ground -- the
 * chip renders its label on nothing, which reads as "styled" at a glance and is
 * only visible in a computed-style check. Callers that want inline styles want
 * this; `bg` stays for callers building their own config objects.
 */
export function campaignStatusCss(status: string): { background: string; color: string } {
  const s = campaignStatusStyle(status);
  return { background: s.bg, color: s.color };
}

/**
 * One colour standing in for a status, for legend dots and other places with no
 * room for a pill. It is the foreground everywhere except Active, whose
 * foreground is white -- a white dot on a white page is not a legend entry.
 */
export function campaignStatusDot(status: string): string {
  const s = campaignStatusStyle(status);
  return s.color.toUpperCase() === "#FFFFFF" ? s.bg : s.color;
}
