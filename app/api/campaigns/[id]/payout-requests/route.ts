import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import { permissionDenial } from "@/lib/authz";
import { sessionCampaignScopeDenial } from "@/lib/campaignAccess";

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
    const outOfScope = await sessionCampaignScopeDenial(session.user, campaignId);
    if (outOfScope) return outOfScope;

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

    // PayoutRequest holds creatorId as a plain string with no relation, so the
    // name has to be looked up — the same join /negotiations already does. The
    // table rendered a truncated cuid ("cmt1m1wq...") in its Creator column,
    // which is the one column an approver needs to read before paying.
    const creatorIds = [...new Set(payoutRequests.map((r) => r.creatorId))];
    const creators = creatorIds.length
      ? await db.creator.findMany({
          where: { id: { in: creatorIds }, orgId },
          select: { id: true, name: true, handle: true },
        })
      : [];
    const byId = new Map(creators.map((c) => [c.id, c]));

    return NextResponse.json({
      payoutRequests: payoutRequests.map((r) => ({
        ...r,
        creator: byId.get(r.creatorId) ?? null,
      })),
    });
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
    const denied =
      permissionDenial(session.user, "payments:manage") ??
      (await sessionCampaignScopeDenial(session.user, campaignId));
    if (denied) return denied;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const body = await request.json();
    const parsed = createRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    /* The creator comes from the body, so it is checked against this org: a
       creator id from another workspace would otherwise be written onto this
       org's row and surface on its screens. */
    const creatorInOrg = await db.creator.findFirst({
      where: { id: parsed.data.creatorId, orgId, deletedAt: null },
      select: { id: true },
    });
    if (!creatorInOrg) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

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
