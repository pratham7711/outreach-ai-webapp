import { db } from "@/lib/db";
import type { CreatorSession } from "@/lib/creator-auth";
import { findCreatorInOrgForHandle } from "@/lib/portal/creatorLookup";
import { isPortalCampaignActionable } from "@/lib/marketplace/portalVisibility";

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
  /* Handle-insensitive to the leading @, via the shared matcher. An exact
     `handle: session.handle` equality looked right and was the one place in the
     portal that did not normalise: a roster row stored as "@blessingjolie"
     never matched a session handle of "blessingjolie", so every marketplace
     join created a SECOND creator in the same org and split that creator's
     activations across two rows. */
  const existing = await findCreatorInOrgForHandle(orgId, session.handle);
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

  /* Status gate. `status` was selected here from the start and never read, so
     a COMPLETE or CANCELLED campaign kept admitting new creators through its
     public slug. Matches the rule /api/portal/proposals already enforced. */
  if (!isPortalCampaignActionable(campaign.status)) {
    return {
      ok: false,
      status: 409,
      error: `This campaign is not currently open to creators (status: ${campaign.status})`,
    };
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
