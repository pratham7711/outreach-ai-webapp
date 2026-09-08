import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession, creatorHandleVariants } from "@/lib/creator-auth";
import { getOrCreateConversation, appendMessage } from "@/lib/negotiation/conversation";
import { getAdvisor } from "@/lib/negotiation/engine";
import { z } from "zod";

const respondSchema = z.object({
  action: z.enum(["accept", "counter"]),
  counterRate: z.number().positive().optional(),
});

function formatRate(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value)}`;
  }
}

// POST /api/portal/offers/[id]/respond — creator accepts or counters an offer
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id: offerId } = await params;

    const body = await request.json();
    const parsed = respondSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }
    const { action } = parsed.data;

    const offer = await db.negotiationOffer.findFirst({ where: { id: offerId } });
    if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

    // Ownership: the org-side creator on the offer must bridge (by handle) to this creator user.
    const creator = await db.creator.findFirst({
      where: { id: offer.creatorId, handle: { in: creatorHandleVariants(session.handle) }, deletedAt: null },
      select: { id: true, followersCount: true, averageViews: true, rate: true },
    });
    if (!creator) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

    if (offer.status === "ACCEPTED" || offer.status === "REJECTED") {
      return NextResponse.json({ error: "Offer is no longer actionable" }, { status: 409 });
    }

    /* An acceptance is terminal for the creator, and the status column cannot
       express that on its own. ACCEPTED is the BRAND's final say — set by
       app/api/negotiations/approve, which (like the org PATCH) refuses an offer
       that is already ACCEPTED — so writing ACCEPTED here would lock the brand
       out of its own approval step. The creator's acceptance is recorded as
       finalRate instead, and finalRate is written in exactly two places: here
       and the brand's approve.

       Without this second guard the ACCEPTED/REJECTED check above never fires
       for a creator, because accept leaves the row at COUNTERED. A creator
       could accept at the standing rate and then counter HIGHER: the counter
       runs its AI round, aiCounterRate moves up, and the brand's approve —
       which recomputes standingRate — pays the new number. They could also
       simply re-accept and rewrite finalRate. */
    if (offer.finalRate != null) {
      return NextResponse.json(
        { error: "You have already accepted this offer; it is awaiting brand approval." },
        { status: 409 }
      );
    }

    const conversationId =
      offer.conversationId ??
      (await getOrCreateConversation({
        orgId: offer.orgId,
        creatorUserId: session.creatorUserId,
        campaignId: offer.campaignId,
      }));

    if (action === "accept") {
      const standing = offer.aiCounterRate ?? offer.counterRate ?? offer.offeredRate;
      const updated = await db.negotiationOffer.update({
        where: { id: offer.id },
        data: {
          status: "COUNTERED",
          finalRate: standing,
          conversationId,
        },
      });
      await appendMessage({
        conversationId,
        senderType: "CREATOR",
        body: `${session.name} accepted ${formatRate(standing, offer.currency)}, awaiting brand approval.`,
        negotiationOfferId: offer.id,
      });
      return NextResponse.json(updated);
    }

    // action === "counter"
    if (parsed.data.counterRate == null) {
      return NextResponse.json({ error: "counterRate is required when countering" }, { status: 400 });
    }
    const creatorCounterRate = parsed.data.counterRate;

    // One-round invariant: the AI already used its single counter-round.
    if (offer.aiRound >= 1) {
      return NextResponse.json(
        { error: "This negotiation has already had its AI counter-round; the brand must decide." },
        { status: 409 }
      );
    }

    const afterCounter = await db.negotiationOffer.update({
      where: { id: offer.id },
      data: {
        status: "COUNTERED",
        counterRate: creatorCounterRate,
        conversationId,
      },
    });
    await appendMessage({
      conversationId,
      senderType: "CREATOR",
      body: `${session.name} countered at ${formatRate(creatorCounterRate, offer.currency)}.`,
      negotiationOfferId: offer.id,
    });

    // Single AI counter-round (aiRound 0 -> 1). Advisor only proposes; never accepts.
    const advisor = getAdvisor();
    const proposal = await advisor.proposeCounter({
      offeredRate: offer.offeredRate,
      creatorCounterRate,
      creatorProfile: {
        followersCount: creator.followersCount,
        avgViews: creator.averageViews,
        rate: creator.rate ?? undefined,
      },
      currency: offer.currency,
    });

    const withAi = await db.negotiationOffer.update({
      where: { id: offer.id },
      data: { aiCounterRate: proposal.counterRate, aiRound: 1 },
    });
    await appendMessage({
      conversationId,
      senderType: "AI_AGENT",
      body: proposal.message,
      negotiationOfferId: offer.id,
    });

    return NextResponse.json({ ...withAi, aiMessage: proposal.message });
  } catch (error) {
    console.error("Failed to respond to offer:", error);
    return NextResponse.json({ error: "Failed to respond to offer" }, { status: 500 });
  }
}
