import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
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
      where: { id: offer.creatorId, handle: session.handle, deletedAt: null },
      select: { id: true, followersCount: true, averageViews: true, rate: true },
    });
    if (!creator) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

    if (offer.status === "ACCEPTED" || offer.status === "REJECTED") {
      return NextResponse.json({ error: "Offer is no longer actionable" }, { status: 409 });
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
