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
