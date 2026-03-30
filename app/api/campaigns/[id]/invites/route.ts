import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import type { InviteChannel } from "@/lib/generated/prisma/client";

const createInviteSchema = z.object({
  creatorId: z.string().min(1),
  channel: z.enum(["INSTAGRAM_DM", "LINK"]).default("LINK"),
});

// GET /api/campaigns/[id]/invites
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const invites = await db.campaignInvite.findMany({
      where: { campaignId, orgId },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ invites });
  } catch (error) {
    console.error("Failed to fetch invites:", error);
    return NextResponse.json({ error: "Failed to fetch invites" }, { status: 500 });
  }
}

// POST /api/campaigns/[id]/invites — Create invite with auto-generated token
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const body = await request.json();
    const parsed = createInviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const invite = await db.campaignInvite.create({
      data: {
        orgId,
        campaignId,
        creatorId: parsed.data.creatorId,
        channel: parsed.data.channel as InviteChannel,
        sentAt: new Date(),
      },
    });

    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: "campaign_invite.create",
      entityType: "CampaignInvite",
      entityId: invite.id,
      entityLabel: `Invite for campaign ${campaignId}`,
      ipAddress: getRequestIp(request),
      after: { id: invite.id, creatorId: invite.creatorId, channel: invite.channel, token: invite.inviteToken },
    });

    return NextResponse.json(invite, { status: 201 });
  } catch (error) {
    console.error("Failed to create invite:", error);
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }
}
