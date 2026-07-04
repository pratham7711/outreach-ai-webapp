import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { computeMarketplaceAnalytics } from "@/lib/marketplace/analytics";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;
    const { id } = await params;

    const campaign = await db.campaign.findFirst({
      where: { id, orgId, deletedAt: null },
      select: {
        id: true,
        marketplaceVisibility: true,
        ratePerThousand: true,
        marketplaceBudgetCapMinor: true,
      },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const analytics = await computeMarketplaceAnalytics(campaign.id, {
      ratePerThousand: campaign.ratePerThousand,
      marketplaceBudgetCapMinor: campaign.marketplaceBudgetCapMinor,
    });

    return NextResponse.json({ visibility: campaign.marketplaceVisibility, ...analytics });
  } catch (error) {
    console.error("Failed to fetch marketplace analytics:", error);
    return NextResponse.json(
      { error: "Failed to fetch marketplace analytics" },
      { status: 500 }
    );
  }
}
