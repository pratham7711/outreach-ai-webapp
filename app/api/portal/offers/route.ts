import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";

// GET /api/portal/offers — negotiation offers addressed to the signed-in creator
export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Bridge CreatorUser -> org-side Creator rows by handle match.
    const creators = await db.creator.findMany({
      where: { handle: session.handle, deletedAt: null },
      select: { id: true, orgId: true },
    });
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
