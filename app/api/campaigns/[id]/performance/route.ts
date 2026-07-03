import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { computeCampaignPerformance } from "@/lib/reports/campaignPerformance";

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
      select: { id: true, orgId: true, budget: true, currency: true },
    });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const performance = await computeCampaignPerformance(campaign);
    return NextResponse.json(performance);
  } catch (error) {
    console.error("Failed to fetch campaign performance:", error);
    return NextResponse.json(
      { error: "Failed to fetch campaign performance" },
      { status: 500 }
    );
  }
}
