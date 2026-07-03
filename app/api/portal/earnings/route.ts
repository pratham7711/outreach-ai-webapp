import { NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { computeCreatorEarnings } from "@/lib/marketplace/earnings";

// GET /api/portal/earnings — per-campaign accrued earnings + totals for the creator
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
      approvedMinor: e.approvedMinor,
      pendingMinor: e.pendingMinor,
      minPayoutMinor: e.minPayoutMinor,
      submissionCount: e.submissionCount,
      canRequestPayout:
        e.minPayoutMinor == null ? e.approvedMinor > 0 : e.approvedMinor >= e.minPayoutMinor,
    }));

    const totalApprovedMinor = campaigns.reduce((s, c) => s + c.approvedMinor, 0);
    const totalPendingMinor = campaigns.reduce((s, c) => s + c.pendingMinor, 0);

    return NextResponse.json({
      campaigns,
      totalApprovedMinor,
      totalPendingMinor,
    });
  } catch (error) {
    console.error("Failed to compute earnings:", error);
    return NextResponse.json({ error: "Failed to compute earnings" }, { status: 500 });
  }
}
