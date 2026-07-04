import { db } from "@/lib/db";
import type { CreatorSession } from "@/lib/creator-auth";

export type JoinResult =
  | { ok: true; activationId: string; creatorId: string; alreadyJoined: boolean; campaignSlug: string }
  | { ok: false; status: number; error: string };

/**
 * Resolve (or lazily create) the org-side Creator row that mirrors a portal
 * CreatorUser. Mirrors the handle-match pattern used across the portal APIs
 * (see payout-requests): a Creator is matched within the campaign's org by
 * handle. If none exists we create a minimal one from the CreatorUser profile
 * so the marketplace link can be represented with the existing Activation model.
 */
export async function resolveOrgCreator(
  orgId: string,
  session: CreatorSession
): Promise<{ id: string }> {
  const existing = await db.creator.findFirst({
    where: { orgId, handle: session.handle, deletedAt: null },
    select: { id: true },
  });
  if (existing) return existing;

  const profile = await db.creatorUser.findUnique({
    where: { id: session.creatorUserId },
    select: {
      name: true,
      handle: true,
      avatarUrl: true,
      bio: true,
      platform: true,
      followersCount: true,
      averageViews: true,
      rate: true,
      email: true,
    },
  });

  const created = await db.creator.create({
    data: {
      orgId,
      name: profile?.name ?? session.name,
      handle: profile?.handle ?? session.handle,
      platform: profile?.platform ?? "TIKTOK",
      avatarUrl: profile?.avatarUrl ?? null,
      bio: profile?.bio ?? null,
      followersCount: profile?.followersCount ?? 0,
      averageViews: profile?.averageViews ?? 0,
      rate: profile?.rate ?? null,
      contactEmail: profile?.email ?? session.email,
    },
    select: { id: true },
  });
  return created;
}

/**
 * Join a marketplace campaign by public slug. Enforces visibility rules,
 * invite codes and submission deadlines. Idempotent: a re-join returns the
 * existing Activation. Never trusts a client-supplied orgId — the org is
 * always read from the campaign row.
 */
export async function joinCampaignBySlug(
  session: CreatorSession,
  slug: string,
  inviteCode?: string
): Promise<JoinResult> {
  const campaign = await db.campaign.findUnique({
    where: { publicSlug: slug },
    select: {
      id: true,
      orgId: true,
      publicSlug: true,
      status: true,
      deletedAt: true,
      marketplaceVisibility: true,
      inviteCode: true,
      submissionDeadline: true,
    },
  });

  if (!campaign || campaign.deletedAt || !campaign.publicSlug) {
    return { ok: false, status: 404, error: "Campaign not found" };
  }

  // Visibility gate
  if (campaign.marketplaceVisibility === "PRIVATE") {
    return { ok: false, status: 403, error: "This campaign is private and not open to joins" };
  }
  if (campaign.marketplaceVisibility === "INVITE_ONLY") {
    if (!inviteCode || !campaign.inviteCode || inviteCode.trim().toUpperCase() !== campaign.inviteCode.toUpperCase()) {
      return { ok: false, status: 403, error: "A valid invite code is required to join this campaign" };
    }
  }

  // Deadline gate
  if (campaign.submissionDeadline && campaign.submissionDeadline.getTime() < Date.now()) {
    return { ok: false, status: 409, error: "The submission deadline for this campaign has passed" };
  }

  const creator = await resolveOrgCreator(campaign.orgId, session);

  // Idempotent link via the existing Activation model
  const existing = await db.activation.findFirst({
    where: { campaignId: campaign.id, creatorId: creator.id, deletedAt: null },
    select: { id: true },
  });
  if (existing) {
    return {
      ok: true,
      activationId: existing.id,
      creatorId: creator.id,
      alreadyJoined: true,
      campaignSlug: campaign.publicSlug,
    };
  }

  const activation = await db.activation.create({
    data: {
      campaignId: campaign.id,
      creatorId: creator.id,
      deliverableDueDate: campaign.submissionDeadline ?? null,
    },
    select: { id: true },
  });

  return {
    ok: true,
    activationId: activation.id,
    creatorId: creator.id,
    alreadyJoined: false,
    campaignSlug: campaign.publicSlug,
  };
}
