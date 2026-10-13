import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { appendMessage } from "@/lib/negotiation/conversation";
import { z } from "zod";
import { permissionDenial } from "@/lib/authz";
import { sessionCampaignScopeDenial } from "@/lib/campaignAccess";

const approveSchema = z.object({ offerId: z.string().min(1) });

function standingRate(offer: { offeredRate: number; counterRate: number | null; aiCounterRate: number | null }): number {
  return offer.aiCounterRate ?? offer.counterRate ?? offer.offeredRate;
}

// POST /api/negotiations/approve — org-only final acceptance
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    /* Deciding an offer is campaign work on the offer's campaign: the same
       permission as making one (campaigns/[id]/negotiations), and the
       campaign's row scope once the offer says which campaign it is. */
    const denied = permissionDenial(session.user, "campaigns:edit_own");
    if (denied) return denied;
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
    const outOfScope = await sessionCampaignScopeDenial(session.user, offer.campaignId);
    if (outOfScope) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

    if (offer.status === "ACCEPTED" || offer.status === "REJECTED") {
      return NextResponse.json({ error: "Offer is no longer actionable" }, { status: 409 });
    }

    const finalRate = standingRate(offer);

    /* Conditional on everything finalRate was computed from. A creator counter
       landing between the read and this write moves counterRate/aiCounterRate
       without changing the status, and a plain update would then approve at a
       rate nobody saw; a second approve or a reject racing this one would also
       land. Any of those now gets a 409 and a re-read. */
    const swapped = await db.negotiationOffer.updateMany({
      where: {
        id: offer.id,
        orgId,
        status: offer.status,
        counterRate: offer.counterRate,
        aiCounterRate: offer.aiCounterRate,
      },
      data: { status: "ACCEPTED", finalRate },
    });
    if (swapped.count === 0) {
      return NextResponse.json({ error: "This offer changed while you were deciding. Reload it and try again." }, { status: 409 });
    }
    const updated = await db.negotiationOffer.findUniqueOrThrow({ where: { id: offer.id } });

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
