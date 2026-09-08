import { PUBLIC_VISIBILITY } from "@/lib/marketplace/public";

/**
 * Who still gets to see a campaign behind a portal slug.
 *
 * publicSlug is public and durable: it stays valid after a campaign is pulled
 * back to PRIVATE, and it was never secret to begin with. So "the caller is
 * some logged-in creator" is not the question — the question is whether THIS
 * creator still has business with the campaign.
 *
 * Two ways through, and only two:
 *
 *  - GLOBAL. The campaign is listed on /explore for anyone; there is nothing to
 *    withhold.
 *  - An activation. joinCampaignBySlug admits INVITE_ONLY with a valid code and
 *    the portal sends the creator straight to their work afterwards, so gating
 *    on GLOBAL alone would 404 people out of campaigns they are already
 *    delivering.
 *
 * A stranger holding a stale slug has neither.
 *
 * This is one function because the three routes behind a slug —
 * /api/portal/campaigns/[slug], its /submissions and its /draft — must agree.
 * They did not: the detail route applied the gate while the two write routes
 * ran their deadline, budget-cap and platform-rate checks first and answered
 * "the submission deadline has passed" or "this campaign has reached its budget
 * cap" for a PRIVATE campaign the caller should not be able to see at all. The
 * writes themselves were always safe — both require an activation — but the
 * error text is a status report on someone else's campaign.
 */
export function isPortalCampaignVisible(input: {
  marketplaceVisibility: string | null;
  hasActivation: boolean;
}): boolean {
  return input.marketplaceVisibility === PUBLIC_VISIBILITY || input.hasActivation;
}

/**
 * The only campaign status a portal creator may act on.
 *
 * /api/portal/proposals already required it (`status: "IN_PROGRESS"` in its
 * campaign lookup) and nothing else did: joinCampaignBySlug SELECTED
 * campaign.status and never read it, and the /submissions and /draft routes did
 * not select it at all. So a campaign an agency had marked COMPLETE or
 * CANCELLED went on accepting joins, posts and drafts through its still-valid
 * public slug, quietly accruing marketplace liability against a closed budget.
 * The three surfaces now agree with proposals.
 */
export const PORTAL_ACTIONABLE_CAMPAIGN_STATUS = "IN_PROGRESS";

export function isPortalCampaignActionable(status: string | null | undefined): boolean {
  return status === PORTAL_ACTIONABLE_CAMPAIGN_STATUS;
}
