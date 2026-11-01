import { db } from "@/lib/db";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import { PORTAL_ACTIONABLE_CAMPAIGN_STATUS } from "@/lib/marketplace/portalVisibility";
import type { Prisma } from "@/lib/generated/prisma";

/**
 * The campaigns a Creator Finder message can invite someone into.
 *
 * A prospect is not on the roster yet, so the per-creator /invite/<token> link
 * can't be used -- it needs a roster row, and creating one would move the card
 * to Joined before anyone said yes. The campaign's own join link can:
 * /portal/register?join=<slug>&invite=<code> is the link the marketplace has
 * always handed out (lib/portal/afterAuth.ts). Joining through it adds the
 * creator to the roster (lib/marketplace/join.ts resolveOrgCreator), and the
 * board then moves the card to Joined on its own.
 *
 * Only campaigns with such a link qualify: listed on the marketplace (GLOBAL) or
 * invite-only with a code, open, and before their submission deadline. A
 * private campaign has no join link; the agency is told how to get one.
 */

export type JoinableCampaign = { id: string; title: string; joinPath: string };

type Scope = Parameters<typeof campaignScopeWhereFor>[0] & { orgId: string };

export function campaignJoinPath(slug: string, inviteCode: string | null): string {
  const q = new URLSearchParams({ join: slug });
  if (inviteCode) q.set("invite", inviteCode);
  return `/portal/register?${q.toString()}`;
}

function joinableWhere(auth: Scope): Prisma.CampaignWhereInput {
  return {
    orgId: auth.orgId,
    deletedAt: null,
    status: PORTAL_ACTIONABLE_CAMPAIGN_STATUS,
    publicSlug: { not: null },
    /* The deadline and visibility rules are ORs, and so is the campaign-scope
       filter, so each sits in AND; spread side by side, one would overwrite
       another's OR key. */
    AND: [
      { OR: [{ submissionDeadline: null }, { submissionDeadline: { gt: new Date() } }] },
      { OR: [{ marketplaceVisibility: "GLOBAL" as const }, { marketplaceVisibility: "INVITE_ONLY" as const, inviteCode: { not: null } }] },
      campaignScopeWhereFor(auth),
    ],
  };
}

const select = { id: true, title: true, publicSlug: true, marketplaceVisibility: true, inviteCode: true } as const;

function toJoinable(c: { id: string; title: string; publicSlug: string | null; marketplaceVisibility: string; inviteCode: string | null }): JoinableCampaign {
  return { id: c.id, title: c.title, joinPath: campaignJoinPath(c.publicSlug as string, c.marketplaceVisibility === "INVITE_ONLY" ? c.inviteCode : null) };
}

export async function listJoinableCampaigns(auth: Scope): Promise<{ campaigns: JoinableCampaign[]; otherOpen: number }> {
  const [rows, open] = await Promise.all([
    db.campaign.findMany({ where: joinableWhere(auth), select, orderBy: { createdAt: "desc" }, take: 100 }),
    db.campaign.count({
      where: { orgId: auth.orgId, deletedAt: null, status: PORTAL_ACTIONABLE_CAMPAIGN_STATUS, ...campaignScopeWhereFor(auth) },
    }),
  ]);
  return { campaigns: rows.map(toJoinable), otherOpen: Math.max(0, open - rows.length) };
}

export async function findJoinableCampaign(
  auth: Scope,
  id: string,
): Promise<(JoinableCampaign & { guidelines: string | null; requirements: string | null }) | null> {
  const row = await db.campaign.findFirst({
    where: { ...joinableWhere(auth), id },
    select: { ...select, guidelines: true, requirements: true },
  });
  return row ? { ...toJoinable(row), guidelines: row.guidelines, requirements: row.requirements } : null;
}
