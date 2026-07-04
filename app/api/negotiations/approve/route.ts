import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { appendMessage } from "@/lib/negotiation/conversation";
import { z } from "zod";

const approveSchema = z.object({ offerId: z.string().min(1) });

function standingRate(offer: { offeredRate: number; counterRate: number | null; aiCounterRate: number | null }): number {
  return offer.aiCounterRate ?? offer.counterRate ?? offer.offeredRate;
}

// POST /api/negotiations/approve — org-only final acceptance
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId as string;

    const body = await request.json();
    const parsed = approveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const offer = await db.negotiationOffer.findFirst({
      where: { id: parsed.data.offerId, orgId },
    });
    if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

    if (offer.status === "ACCEPTED" || offer.status === "REJECTED") {
      return NextResponse.json({ error: "Offer is no longer actionable" }, { status: 409 });
    }

    const finalRate = standingRate(offer);

    const updated = await db.negotiationOffer.update({
      where: { id: offer.id },
      data: { status: "ACCEPTED", finalRate },
    });

    if (offer.conversationId) {
      await appendMessage({
        conversationId: offer.conversationId,
        senderType: "ORG",
        body: `The brand has approved the deal at ${new Intl.NumberFormat("en-US", { style: "currency", currency: offer.currency, maximumFractionDigits: 0 }).format(finalRate)}. Welcome aboard!`,
        negotiationOfferId: offer.id,
        senderUserId: session.user.id ?? null,
      });
    }

    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: "negotiation.approve",
      entityType: "NegotiationOffer",
      entityId: offer.id,
      entityLabel: `Approved at ${finalRate} ${offer.currency}`,
      ipAddress: getRequestIp(request),
      before: { status: offer.status, finalRate: offer.finalRate },
      after: { status: updated.status, finalRate: updated.finalRate },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to approve negotiation:", error);
    return NextResponse.json({ error: "Failed to approve negotiation" }, { status: 500 });
  }
}
