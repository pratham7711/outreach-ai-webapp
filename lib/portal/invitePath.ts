/**
 * Where a campaign invite lands, as a path.
 *
 * Pure so the agency's Invites table (a client component) and the API that
 * lists invites can both build it. The copied link used to be
 * /api/campaign-invites/respond?token=..., a POST-only route: opened in a
 * browser it answered 405, so every invite an agency ever shared was dead on
 * arrival. /invite/<token> is the landing page with the brief, the dates and the
 * Accept button.
 */
export function campaignInvitePath(token: string): string {
  return `/invite/${encodeURIComponent(token)}`;
}

/**
 * Where the creator app shows one campaign. Marketplace campaigns keep their
 * public slug, which /explore and the pinned /portal/register?join= link
 * already use; an agency's private campaign has no slug, so its id stands in.
 * lib/portal/campaignAccess.ts resolves either.
 */
export function portalCampaignPath(campaign: { id: string; publicSlug: string | null }): string {
  return `/portal/campaigns/${encodeURIComponent(campaign.publicSlug ?? campaign.id)}`;
}
