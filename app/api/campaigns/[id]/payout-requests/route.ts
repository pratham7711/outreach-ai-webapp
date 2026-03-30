import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";

const createRequestSchema = z.object({
  creatorId: z.string().min(1),
  requestedAmount: z.number().positive(),
  currency: z.string().default("USD"),
});

// GET /api/campaigns/[id]/payout-requests
export async function GET(
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

    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status");
    const creatorId = searchParams.get("creatorId");

    const where: Record<string, unknown> = { campaignId, orgId };
    if (status) where.status = status;
    if (creatorId) where.creatorId = creatorId;

    const payoutRequests = await db.payoutRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ payoutRequests });
  } catch (error) {
    console.error("Failed to fetch payout requests:", error);
    return NextResponse.json({ error: "Failed to fetch payout requests" }, { status: 500 });
  }
}

// POST /api/campaigns/[id]/payout-requests — Create payout request
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
    const parsed = createRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const payoutRequest = await db.payoutRequest.create({
      data: {
        orgId,
        campaignId,
        creatorId: parsed.data.creatorId,
        requestedAmount: parsed.data.requestedAmount,
        currency: parsed.data.currency,
        status: "PENDING",
      },
    });

    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: "payout_request.create",
      entityType: "PayoutRequest",
      entityId: payoutRequest.id,
      entityLabel: `${payoutRequest.currency} ${payoutRequest.requestedAmount}`,
      ipAddress: getRequestIp(request),
      after: { id: payoutRequest.id, creatorId: payoutRequest.creatorId, amount: payoutRequest.requestedAmount, status: payoutRequest.status },
    });

    return NextResponse.json(payoutRequest, { status: 201 });
  } catch (error) {
    console.error("Failed to create payout request:", error);
    return NextResponse.json({ error: "Failed to create payout request" }, { status: 500 });
  }
}
