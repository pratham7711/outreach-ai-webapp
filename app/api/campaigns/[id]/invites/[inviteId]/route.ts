import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import type { InviteStatus } from "@/lib/generated/prisma/client";

const updateInviteSchema = z.object({
  action: z.enum(["RESEND", "CANCEL"]),
});

// PATCH /api/campaigns/[id]/invites/[inviteId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; inviteId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId, inviteId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const existing = await db.campaignInvite.findFirst({ where: { id: inviteId, campaignId, orgId } });
    if (!existing) return NextResponse.json({ error: "Invite not found" }, { status: 404 });

    const body = await request.json();
    const parsed = updateInviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    let data: { sentAt?: Date; status?: InviteStatus; respondedAt?: Date };
    if (parsed.data.action === "RESEND") {
      if (existing.status !== "PENDING") {
        return NextResponse.json({ error: "Can only resend pending invites" }, { status: 400 });
      }
      data = { sentAt: new Date() };
    } else {
      data = { status: "EXPIRED" as InviteStatus, respondedAt: new Date() };
    }

    const updated = await db.campaignInvite.update({
      where: { id: inviteId },
      data,
    });

    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: `campaign_invite.${parsed.data.action.toLowerCase()}`,
      entityType: "CampaignInvite",
      entityId: inviteId,
      entityLabel: `Invite ${parsed.data.action.toLowerCase()}`,
      ipAddress: getRequestIp(request),
      before: { status: existing.status, sentAt: existing.sentAt },
      after: { status: updated.status, sentAt: updated.sentAt },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update invite:", error);
    return NextResponse.json({ error: "Failed to update invite" }, { status: 500 });
  }
}
