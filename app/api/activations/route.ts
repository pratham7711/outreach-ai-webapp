import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { searchParams } = req.nextUrl;
  const campaignId = searchParams.get("campaignId");
  const where = { deletedAt: null, campaign: { orgId }, ...(campaignId && { campaignId }) };
  const activations = await db.activation.findMany({ where, include: { creator: { select: { id: true, name: true, handle: true, platform: true, avatarUrl: true } }, campaign: { select: { id: true, title: true } } }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ activations });
}

export async function POST(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { campaignId, creatorId, deliverableDueDate } = await req.json();
  if (!campaignId || !creatorId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  const creator = await db.creator.findFirst({ where: { id: creatorId, orgId, deletedAt: null } });
  if (!creator) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

  // The campaign page hides creators it has already attached, but that filter
  // runs in one browser tab against one snapshot. Two tabs, a retried request,
  // or any caller that is not that page could attach the same creator twice,
  // and the campaign would then carry two activations that both look real.
  // Guarded here rather than with a unique index because an activation is soft
  // deleted, and a unique pair would refuse to re-add a creator who was removed.
  const already = await db.activation.findFirst({
    where: { campaignId, creatorId, deletedAt: null },
    select: { id: true },
  });
  if (already) {
    return NextResponse.json(
      { error: "That creator is already on this campaign", activationId: already.id },
      { status: 409 }
    );
  }

  try {
    const activation = await db.activation.create({
      data: { campaignId, creatorId, deliverableDueDate: deliverableDueDate ? new Date(deliverableDueDate) : null },
    });

    await logAudit({
      orgId,
      ...getAuditActor(result),
      action: "activation.create",
      entityType: "activation",
      entityId: activation.id,
      entityLabel: activation.id,
      ipAddress: getRequestIp(req),
      after: {
        id: activation.id,
        campaignId: activation.campaignId,
        creatorId: activation.creatorId,
        status: activation.status,
      },
    });

    return NextResponse.json(activation, { status: 201 });
  } catch (err) {
    console.error("Failed to create activation:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
