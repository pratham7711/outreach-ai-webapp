import { db } from "@/lib/db";
import { resolveCapabilities } from "@/lib/capabilities";
import { onboardingProgress, type OnboardingProgress, type OnboardingSnapshot } from "./steps";

export async function readOnboardingSnapshot(orgId: string): Promise<OnboardingSnapshot> {
  const [org, clients, campaigns, creators, activations, postsTracked, teamMembers, pendingInvites, payouts] =
    await Promise.all([
      db.organization.findUnique({ where: { id: orgId }, select: { orgType: true } }),
      db.client.count({ where: { orgId } }),
      db.campaign.count({ where: { orgId, deletedAt: null } }),
      db.creator.count({ where: { orgId, deletedAt: null } }),
      db.activation.count({ where: { campaign: { orgId, deletedAt: null }, deletedAt: null } }),
      db.post.count({ where: { campaign: { orgId, deletedAt: null } } }),
      db.user.count({ where: { orgId } }),
      db.userInvite.count({ where: { orgId, acceptedAt: null, expiresAt: { gt: new Date() } } }),
      db.payout.count({ where: { orgId } }),
    ]);

  return {
    orgType: org?.orgType === "BRAND" ? "BRAND" : "AGENCY",
    clients,
    campaigns,
    creators,
    activations,
    postsTracked,
    teamMembers,
    pendingInvites,
    payouts,
  };
}

export async function getOnboardingProgress(orgId: string): Promise<OnboardingProgress> {
  return onboardingProgress(await readOnboardingSnapshot(orgId), resolveCapabilities());
}
