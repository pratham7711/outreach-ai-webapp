import { db } from "@/lib/db";
import type { CreatorSession } from "@/lib/creator-auth";
import { logAudit } from "@/lib/audit";
import { campaignDates, type CampaignDate } from "@/lib/portal/campaignDates";
import { portalCampaignPath } from "@/lib/portal/invitePath";
import { isPortalCampaignActionable } from "@/lib/marketplace/portalVisibility";

/**
 * An agency's per-creator campaign invite, from the creator's side.
 *
 * CampaignInvite has always been created by the agency (Invite Creator on a
 * campaign) and carries an unguessable token. What it never had was a way in:
 * the copied link pointed at a POST-only API route, nothing showed the creator
 * what they were being invited to, and accepting only flipped the invite's
 * status -- no activation, so the creator was never actually on the campaign.
 *
 * Accepting now does the three things it always implied:
 *
 *  1. links the invited roster row to the accepting login (creatorUserId). The
 *     token is the agency's own per-creator grant, handed to that creator
 *     through the agency's channel, which makes it the same kind of proof as a
 *     creator's own marketplace join (lib/portal/creatorLink.ts, proof 1). It
 *     is also what lets the campaign appear under Joined at all -- private
 *     campaigns are listed only through identity-linked rows (F10).
 *  2. creates the activation, idempotently, the way every other path does
 *     (lib/marketplace/join.ts, /api/activations): find the live one first.
 *  3. marks the invite ACCEPTED.
 *
 * A row already linked to a DIFFERENT login is refused rather than re-pointed:
 * whoever accepted first is the creator the agency is working with, and a
 * forwarded link must not move that.
 *
 * Nothing here contacts the creator. The landing page is read-only and the
 * only side effects are rows in our own database and the agency's audit log.
 */

export type InviteLanding = {
  status: "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED";
  /** False once the agency has closed the campaign; Accept is then withheld. */
  open: boolean;
  campaign: {
    title: string;
    orgName: string;
    orgLogoUrl: string | null;
    brief: string | null;
    guidelines: string | null;
    requirements: string | null;
    contentAssetsUrl: string | null;
    dates: CampaignDate[];
  };
};

/** Tokens are cuids (CampaignInvite.inviteToken @default(cuid())). */
const TOKEN = /^[a-z0-9]{20,40}$/i;

export function isInviteTokenShape(token: string): boolean {
  return TOKEN.test(token);
}

/**
 * What the landing page shows. Deliberately a whitelist: the page is public to
 * whoever holds the link, so it carries the brief and the dates and nothing
 * about the agency's roster, budget or other creators -- and not the name of
 * the creator the invite is for, so a forwarded link discloses nobody.
 */
export async function loadInviteLanding(token: string): Promise<InviteLanding | null> {
  if (!isInviteTokenShape(token)) return null;
  const invite = await db.campaignInvite.findUnique({
    where: { inviteToken: token },
    select: { orgId: true, campaignId: true, status: true },
  });
  if (!invite) return null;

  const campaign = await db.campaign.findFirst({
    where: { id: invite.campaignId, orgId: invite.orgId, deletedAt: null },
    select: {
      title: true,
      status: true,
      guidelines: true,
      requirements: true,
      contentAssetsUrl: true,
      submissionDeadline: true,
      brief: { select: { content: true } },
      phases: {
        select: { name: true, startDate: true, endDate: true },
        orderBy: { sequence: "asc" },
      },
      org: { select: { name: true, brandName: true, logoUrl: true } },
    },
  });
  if (!campaign) return null;

  return {
    status: invite.status,
    open: isPortalCampaignActionable(campaign.status),
    campaign: {
      title: campaign.title,
      orgName: campaign.org.brandName || campaign.org.name,
      orgLogoUrl: campaign.org.logoUrl ?? null,
      brief: campaign.brief?.content?.trim() || null,
      guidelines: campaign.guidelines,
      requirements: campaign.requirements,
      contentAssetsUrl: campaign.contentAssetsUrl,
      dates: campaignDates({ submissionDeadline: campaign.submissionDeadline, phases: campaign.phases }),
    },
  };
}

export type AcceptResult =
  | { ok: true; campaignPath: string; activationId: string; alreadyAccepted: boolean }
  | { ok: false; status: number; error: string };

export async function acceptCampaignInvite(
  session: Pick<CreatorSession, "creatorUserId" | "email">,
  token: string,
): Promise<AcceptResult> {
  if (!isInviteTokenShape(token)) return { ok: false, status: 404, error: "Invite not found" };

  const invite = await db.campaignInvite.findUnique({
    where: { inviteToken: token },
    select: { id: true, orgId: true, campaignId: true, creatorId: true, status: true },
  });
  if (!invite) return { ok: false, status: 404, error: "Invite not found" };
  if (invite.status === "DECLINED" || invite.status === "EXPIRED") {
    return { ok: false, status: 409, error: "This invite is no longer open. Ask the agency for a new link." };
  }

  const campaign = await db.campaign.findFirst({
    where: { id: invite.campaignId, orgId: invite.orgId, deletedAt: null },
    select: { id: true, publicSlug: true, status: true, submissionDeadline: true },
  });
  if (!campaign) return { ok: false, status: 404, error: "Invite not found" };

  const creator = await db.creator.findFirst({
    where: { id: invite.creatorId, orgId: invite.orgId, deletedAt: null },
    select: { id: true, creatorUserId: true },
  });
  if (!creator) {
    return { ok: false, status: 409, error: "This invite is no longer valid. Ask the agency for a new link." };
  }
  if (creator.creatorUserId && creator.creatorUserId !== session.creatorUserId) {
    return {
      ok: false,
      status: 409,
      error: "This invite was already accepted from another account. Sign in with that account instead.",
    };
  }

  const campaignPath = portalCampaignPath(campaign);
  const existing = await db.activation.findFirst({
    where: { campaignId: campaign.id, creatorId: creator.id, deletedAt: null },
    select: { id: true },
  });

  /* An invite accepted earlier from this same login is a repeat tap on the
     button or a reopened link: answer with the campaign, change nothing. */
  if (invite.status === "ACCEPTED" && creator.creatorUserId === session.creatorUserId && existing) {
    return { ok: true, campaignPath, activationId: existing.id, alreadyAccepted: true };
  }

  if (!isPortalCampaignActionable(campaign.status)) {
    return { ok: false, status: 409, error: "This campaign has closed, so the invite can no longer be accepted." };
  }

  /* The link is written conditionally on the row still being unlinked, so two
     logins accepting the same forwarded link at once cannot both win: the
     loser's updateMany matches nothing and is refused below. */
  if (!creator.creatorUserId) {
    const linked = await db.creator.updateMany({
      where: { id: creator.id, orgId: invite.orgId, creatorUserId: null },
      data: { creatorUserId: session.creatorUserId },
    });
    if (linked.count === 0) {
      return {
        ok: false,
        status: 409,
        error: "This invite was already accepted from another account. Sign in with that account instead.",
      };
    }
  }

  const activationId =
    existing?.id ??
    (
      await db.activation.create({
        data: {
          campaignId: campaign.id,
          creatorId: creator.id,
          deliverableDueDate: campaign.submissionDeadline ?? null,
        },
        select: { id: true },
      })
    ).id;

  await db.campaignInvite.updateMany({
    where: { id: invite.id, status: "PENDING" },
    data: { status: "ACCEPTED", respondedAt: new Date() },
  });

  await logAudit({
    orgId: invite.orgId,
    actorType: "creator",
    actorEmail: session.email,
    action: "campaign_invite.accept",
    entityType: "CampaignInvite",
    entityId: invite.id,
    entityLabel: "Creator accepted a campaign invite",
    after: { campaignId: campaign.id, creatorId: creator.id, activationId },
  });

  return { ok: true, campaignPath, activationId, alreadyAccepted: !!existing };
}
