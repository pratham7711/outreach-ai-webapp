import { db } from "@/lib/db";
import type { CreatorSession } from "@/lib/creator-auth";
import { findCreatorInOrgForHandle } from "@/lib/portal/creatorLookup";
import { isPortalCampaignVisible } from "@/lib/marketplace/portalVisibility";

/**
 * One campaign, as the creator app reaches it: by public slug or by id, and
 * with the creator's own activation on it if they have one.
 *
 * The three routes behind /api/portal/campaigns/[slug] (detail, submissions,
 * draft) each resolved this themselves, by slug only and by handle only. That
 * had two consequences once agencies' private campaigns joined the creator
 * app:
 *
 *  - a private campaign has no public slug, so a creator invited to one had no
 *    URL to open it at. The key is now a slug or, failing that, an id.
 *  - the activation was found by handle, so a PRIVATE campaign that happened to
 *    carry a slug opened to anyone who registered the handle of a creator on it
 *    (plan failure F10). An activation now counts for a PRIVATE campaign only
 *    through a roster row linked to this login (Creator.creatorUserId). The
 *    handle match survives for marketplace campaigns, which is what the portal
 *    always used it for.
 *
 * Visibility itself is still isPortalCampaignVisible, the one rule all three
 * routes share; only where `hasActivation` comes from changed.
 */

/** Campaign ids are cuids; anything else cannot be one, so it is not looked up. */
const CAMPAIGN_ID = /^c[a-z0-9]{20,32}$/;

/**
 * Whether a key that matched no public slug may be a campaign id. Each route
 * does the two lookups itself -- slug first, then id -- so Prisma keeps typing
 * the route's own `select`:
 *
 *   const c = (await db.campaign.findUnique({ where: { publicSlug: key }, select }))
 *     ?? (isCampaignIdKey(key) ? await db.campaign.findUnique({ where: { id: key }, select }) : null);
 */
export function isCampaignIdKey(key: string): boolean {
  return CAMPAIGN_ID.test(key);
}

export const PORTAL_ACTIVATION_SELECT = {
  id: true,
  creatorId: true,
  status: true,
  deliverableDueDate: true,
  draftUrl: true,
  draftCaption: true,
  draftMediaType: true,
  draftSubmittedAt: true,
  feedbackNotes: true,
} as const;

export type PortalActivation = {
  id: string;
  creatorId: string;
  status: string;
  deliverableDueDate: Date | null;
  draftUrl: string | null;
  draftCaption: string | null;
  draftMediaType: string | null;
  draftSubmittedAt: Date | null;
  feedbackNotes: string | null;
};

type CampaignForAccess = { id: string; orgId: string; marketplaceVisibility: string | null };

export type PortalAccess = {
  /** The roster row this creator acts as on the campaign; null if none. */
  creatorId: string | null;
  activation: PortalActivation | null;
  /** How the activation was found -- "identity" is the only way into PRIVATE. */
  via: "identity" | "handle" | null;
  visible: boolean;
};

export async function resolvePortalAccess(
  session: Pick<CreatorSession, "creatorUserId" | "handle">,
  campaign: CampaignForAccess,
): Promise<PortalAccess> {
  const linked = await db.creator.findMany({
    where: { orgId: campaign.orgId, creatorUserId: session.creatorUserId, deletedAt: null },
    select: { id: true },
    orderBy: { addedAt: "asc" },
  });

  if (linked.length > 0) {
    const activation = (await db.activation.findFirst({
      where: {
        campaignId: campaign.id,
        creatorId: { in: linked.map((c) => c.id) },
        deletedAt: null,
      },
      select: PORTAL_ACTIVATION_SELECT,
    })) as PortalActivation | null;
    if (activation) {
      return { creatorId: activation.creatorId, activation, via: "identity", visible: true };
    }
  }

  if (campaign.marketplaceVisibility !== "PRIVATE") {
    /* findCreatorInOrgForHandle rather than an exact `handle` equality: a
       roster stores handles with or without the leading @, and join resolves
       the same row @-insensitively. */
    const creator = await findCreatorInOrgForHandle(campaign.orgId, session.handle);
    const activation = creator
      ? ((await db.activation.findFirst({
          where: { campaignId: campaign.id, creatorId: creator.id, deletedAt: null },
          select: PORTAL_ACTIVATION_SELECT,
        })) as PortalActivation | null)
      : null;
    return {
      creatorId: creator?.id ?? null,
      activation,
      via: activation ? "handle" : null,
      visible: isPortalCampaignVisible({
        marketplaceVisibility: campaign.marketplaceVisibility,
        hasActivation: !!activation,
      }),
    };
  }

  return { creatorId: linked[0]?.id ?? null, activation: null, via: null, visible: false };
}
