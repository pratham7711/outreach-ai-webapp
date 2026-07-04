import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";

const createOfferSchema = z.object({
  creatorId: z.string().min(1),
  offeredRate: z.number().positive(),
  currency: z.string().default("USD"),
  notes: z.string().nullable().optional(),
});

// GET /api/campaigns/[id]/negotiations
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
    const creatorId = searchParams.get("creatorId");

    const where: Record<string, unknown> = { campaignId, orgId };
    if (creatorId) where.creatorId = creatorId;

    const negotiations = await db.negotiationOffer.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });

    let acceptedTotal = 0;
    let pendingEstimate = 0;
    for (const n of negotiations as Array<{
      status?: string;
      offeredRate?: number;
      counterRate?: number | null;
      aiCounterRate?: number | null;
      finalRate?: number | null;
    }>) {
      const standing = n.aiCounterRate ?? n.counterRate ?? n.offeredRate ?? 0;
      if (n.status === "ACCEPTED") {
        acceptedTotal += n.finalRate ?? standing;
      } else if (n.status === "PENDING" || n.status === "COUNTERED") {
        pendingEstimate += standing;
      }
    }

    return NextResponse.json({ negotiations, aggregate: { acceptedTotal, pendingEstimate } });
  } catch (error) {
    console.error("Failed to fetch negotiations:", error);
    return NextResponse.json({ error: "Failed to fetch negotiations" }, { status: 500 });
  }
}

// POST /api/campaigns/[id]/negotiations — Create offer
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
    const parsed = createOfferSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const offer = await db.negotiationOffer.create({
      data: {
        campaignId,
        orgId,
        creatorId: parsed.data.creatorId,
        offeredRate: parsed.data.offeredRate,
        currency: parsed.data.currency,
        notes: parsed.data.notes ?? null,
        status: "PENDING",
      },
    });

    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: "negotiation.create",
      entityType: "NegotiationOffer",
      entityId: offer.id,
      entityLabel: `Offer ${offer.offeredRate} ${offer.currency}`,
      ipAddress: getRequestIp(request),
      after: { id: offer.id, creatorId: offer.creatorId, offeredRate: offer.offeredRate, status: offer.status },
    });

    return NextResponse.json(offer, { status: 201 });
  } catch (error) {
    console.error("Failed to create offer:", error);
    return NextResponse.json({ error: "Failed to create offer" }, { status: 500 });
  }
}
