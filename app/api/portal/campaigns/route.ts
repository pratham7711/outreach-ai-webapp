import { NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { computeCreatorEarnings } from "@/lib/marketplace/earnings";

// GET /api/portal/campaigns — list campaigns the current creator has joined
export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const earnings = await computeCreatorEarnings(session.creatorUserId, session.handle);

    const campaigns = earnings.map((e) => ({
      campaignId: e.campaignId,
      title: e.campaignTitle,
      slug: e.publicSlug,
      orgName: e.orgName,
      currency: e.currency,
      rates: e.rates,
      submissionCount: e.submissionCount,
      approvedMinor: e.approvedMinor,
      pendingMinor: e.pendingMinor,
      minPayoutMinor: e.minPayoutMinor,
    }));

    return NextResponse.json({ campaigns });
  } catch (error) {
    console.error("Failed to fetch joined campaigns:", error);
    return NextResponse.json({ error: "Failed to fetch campaigns" }, { status: 500 });
  }
}
