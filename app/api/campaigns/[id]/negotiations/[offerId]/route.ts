import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { z } from "zod";
import type { NegotiationStatus } from "@/lib/generated/prisma/client";

const updateOfferSchema = z.object({
  action: z.enum(["ACCEPTED", "REJECTED", "COUNTERED"]),
  counterRate: z.number().positive().optional(),
  notes: z.string().nullable().optional(),
});

// PATCH /api/campaigns/[id]/negotiations/[offerId]
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; offerId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId, offerId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const existing = await db.negotiationOffer.findFirst({ where: { id: offerId, campaignId, orgId } });
    if (!existing) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

    if (existing.status !== "PENDING" && existing.status !== "COUNTERED") {
      return NextResponse.json({ error: "Offer is no longer actionable" }, { status: 400 });
    }

    const body = await request.json();
    const parsed = updateOfferSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    if (parsed.data.action === "COUNTERED" && !parsed.data.counterRate) {
      return NextResponse.json({ error: "counterRate is required when countering" }, { status: 400 });
    }

    const updated = await db.negotiationOffer.update({
      where: { id: offerId },
      data: {
        status: parsed.data.action as NegotiationStatus,
        counterRate: parsed.data.action === "COUNTERED" ? parsed.data.counterRate : existing.counterRate,
        notes: parsed.data.notes !== undefined ? parsed.data.notes : existing.notes,
      },
    });

    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: `negotiation.${parsed.data.action.toLowerCase()}`,
      entityType: "NegotiationOffer",
      entityId: offerId,
      entityLabel: `Offer ${parsed.data.action.toLowerCase()}`,
      ipAddress: getRequestIp(request),
      before: { status: existing.status, counterRate: existing.counterRate },
      after: { status: updated.status, counterRate: updated.counterRate },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to update offer:", error);
    return NextResponse.json({ error: "Failed to update offer" }, { status: 500 });
  }
}
