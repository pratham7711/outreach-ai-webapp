import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import type { ProposalStatus } from "@/lib/generated/prisma/client";
import { findCreatorInOrgForHandle } from "@/lib/portal/creatorLookup";
import { stripAt } from "@/lib/format";

const updateProposalSchema = z.object({
  action: z.enum(["ACCEPTED", "REJECTED"]),
});

// PATCH /api/campaigns/[id]/proposals/[proposalId] — Accept or reject a proposal
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; proposalId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId, proposalId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const proposal = await db.campaignProposal.findFirst({
      where: { id: proposalId, campaignId },
      include: { creatorUser: { select: { id: true, name: true, handle: true, platform: true, followersCount: true, averageViews: true, rate: true } } },
    });
    if (!proposal) return NextResponse.json({ error: "Proposal not found" }, { status: 404 });

    if (proposal.status !== "PENDING") {
      return NextResponse.json({ error: "Proposal has already been processed" }, { status: 400 });
    }

    const body = await request.json();
    const parsed = updateProposalSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const updated = await db.campaignProposal.update({
      where: { id: proposalId },
      data: { status: parsed.data.action as ProposalStatus },
    });

    // If accepted, auto-create an Activation
    let activation = null;
    if (parsed.data.action === "ACCEPTED") {
      /* Find or create the org-side Creator record for this CreatorUser, via
         the shared matcher rather than an exact equality on the handle. The
         two sides disagree about the leading "@" -- 10 of the 1,832 roster
         rows are stored as "@handle" while every portal account is bare
         (MEASURED 2026-09-15) -- so `handle: proposal.creatorUser.handle`
         missed the existing row and accepting a proposal minted a SECOND
         creator in the same org, splitting that creator's activations across
         two rows. The same mistake, and the same fix, as marketplace/join. */
      let creator = await findCreatorInOrgForHandle(orgId, proposal.creatorUser.handle);

      if (!creator) {
        creator = await db.creator.create({
          data: {
            orgId,
            name: proposal.creatorUser.name,
            /* Stored bare. The roster's "@" spellings are an import artefact,
               not a format this app should keep producing. */
            handle: stripAt(proposal.creatorUser.handle),
            platform: proposal.creatorUser.platform,
            followersCount: proposal.creatorUser.followersCount,
            averageViews: proposal.creatorUser.averageViews,
            rate: proposal.proposedRate,
          },
          select: { id: true },
        });
      }

      activation = await db.activation.create({
        data: {
          campaignId,
          creatorId: creator.id,
          status: "AWAITING_DRAFT",
        },
      });
    }

    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: `proposal.${parsed.data.action.toLowerCase()}`,
      entityType: "CampaignProposal",
      entityId: proposalId,
      entityLabel: `Proposal from ${proposal.creatorUser.name}`,
      ipAddress: getRequestIp(request),
      before: { status: proposal.status },
      after: { status: updated.status, activationId: activation?.id ?? null },
    });

    return NextResponse.json({ proposal: updated, activation });
  } catch (error) {
    console.error("Failed to update proposal:", error);
    return NextResponse.json({ error: "Failed to update proposal" }, { status: 500 });
  }
}
