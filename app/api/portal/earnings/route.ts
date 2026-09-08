import { NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { computeCreatorEarnings } from "@/lib/marketplace/earnings";
import { totalsByCurrency } from "@/lib/money";

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

    /* Bucketed per currency. A creator can hold approved earnings on a USD
       campaign and an INR one at the same time, and the two flat sums this
       replaced were added across both and then printed with a dollar sign --
       a balance that was wrong in both currencies. Amounts stay in minor
       units, which is what the whole marketplace path speaks. */
    const approvedByCurrency = totalsByCurrency(
      campaigns.map((c) => ({ currency: c.currency, amount: c.approvedMinor }))
    ).map((t) => ({ currency: t.currency, minor: t.amount }));
    const pendingByCurrency = totalsByCurrency(
      campaigns.map((c) => ({ currency: c.currency, amount: c.pendingMinor }))
    ).map((t) => ({ currency: t.currency, minor: t.amount }));

    return NextResponse.json({
      campaigns,
      approvedByCurrency,
      pendingByCurrency,
    });
  } catch (error) {
    console.error("Failed to compute earnings:", error);
    return NextResponse.json({ error: "Failed to compute earnings" }, { status: 500 });
  }
}
