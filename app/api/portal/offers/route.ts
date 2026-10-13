import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";

// GET /api/portal/offers — negotiation offers addressed to the signed-in creator
export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    /* Proven ownership only (lib/portal/creatorLink.ts): a roster row linked to
       this login by identity, or carrying an OAuth-connected account whose
       platform handle is this portal handle -- the same rule connections,
       insights, reviews and earnings use. Matching by handle alone handed any
       account that registered "bigcreator" every agency's offers to the roster
       row of that name: the rate, the agency, the campaign, and the right to
       accept or counter. A creator the agency rostered before they signed up
       sees their offers once they link, by accepting the agency's invite link
       or connecting the account. */
    const creators = await findLinkedCreatorsForHandle(session);
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
