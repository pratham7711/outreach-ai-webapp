import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { findCreatorsForHandle } from "@/lib/portal/creatorLookup";

// GET /api/portal/offers — negotiation offers addressed to the signed-in creator
export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    /* Offers stay on the handle bridge, not the proven-ownership link in
       lib/portal/creatorLink.ts: an offer is addressed to a handle, and the
       roster flow is "agency makes an offer → creator registers → creator
       counters" before any email or OAuth proof exists (the E2E fixture is
       exactly that creator). The brand still has to approve, so an unproven
       counter cannot sign anyone to a rate by itself. Connections, insights,
       reviews and earnings remain ownership-gated. */
    const creators = await findCreatorsForHandle(session.handle);
    if (creators.length === 0) {
      return NextResponse.json({ offers: [] });
    }
    const creatorIds = creators.map((c) => c.id);

    const rows = await db.negotiationOffer.findMany({
      where: { creatorId: { in: creatorIds } },
      orderBy: { createdAt: "desc" },
      include: {
        campaign: { select: { id: true, title: true, org: { select: { name: true } } } },
      },
    });

    const offers = rows.map((o) => ({
      id: o.id,
      campaignId: o.campaignId,
      campaignTitle: o.campaign?.title ?? "Campaign",
      orgName: o.campaign?.org?.name ?? "Brand",
      offeredRate: o.offeredRate,
      counterRate: o.counterRate,
      aiCounterRate: o.aiCounterRate,
      finalRate: o.finalRate,
      currency: o.currency,
      status: o.status,
      aiRound: o.aiRound,
      createdAt: o.createdAt,
    }));

    return NextResponse.json({ offers });
  } catch (error) {
    console.error("Failed to fetch portal offers:", error);
    return NextResponse.json({ error: "Failed to fetch offers" }, { status: 500 });
  }
}
