import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { appendMessage } from "@/lib/negotiation/conversation";
import { z } from "zod";

const rejectSchema = z.object({ offerId: z.string().min(1) });

// POST /api/negotiations/reject — org-only rejection
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId as string;

    const body = await request.json();
    const parsed = rejectSchema.safeParse(body);
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

    const updated = await db.negotiationOffer.update({
      where: { id: offer.id },
      data: { status: "REJECTED" },
    });

    if (offer.conversationId) {
      await appendMessage({
        conversationId: offer.conversationId,
        senderType: "ORG",
        body: "Thank you for your time. Unfortunately the brand has decided not to move forward on this one.",
        negotiationOfferId: offer.id,
        senderUserId: session.user.id ?? null,
      });
    }

    await logAudit({
      orgId,
      ...createAuditActor(session),
      action: "negotiation.reject",
      entityType: "NegotiationOffer",
      entityId: offer.id,
      entityLabel: "Rejected offer",
      ipAddress: getRequestIp(request),
      before: { status: offer.status },
      after: { status: updated.status },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to reject negotiation:", error);
    return NextResponse.json({ error: "Failed to reject negotiation" }, { status: 500 });
  }
}
