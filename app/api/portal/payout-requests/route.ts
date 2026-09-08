import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { z } from "zod";
import { findCreatorInOrgForHandle } from "@/lib/portal/creatorLookup";
import { computeCreatorEarnings } from "@/lib/marketplace/earnings";

// GET /api/portal/payout-requests — List payout requests for current creator user
export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const requests = await db.payoutRequest.findMany({
      where: { creatorUserId: session.creatorUserId },
      include: {
        campaign: { select: { title: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ requests });
  } catch (error) {
    console.error("Failed to fetch payout requests:", error);
    return NextResponse.json({ error: "Failed to fetch payout requests" }, { status: 500 });
  }
}

/* No `currency` here on purpose: it used to be free text on the request body,
   so a creator could file a request denominated in whatever they liked and the
   agency's payouts screen would show it verbatim. The currency of a payout is a
   property of the campaign, and it is read from the campaign row below. */
const postSchema = z.object({
  campaignId: z.string().min(1),
  requestedAmount: z.number().positive().finite(),
});

/** Two decimal places, so float noise never reads as an over-request. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// POST /api/portal/payout-requests — Create a payout request
export async function POST(req: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const { campaignId, requestedAmount } = parsed.data;

    // Authorize: an ACCEPTED proposal (negotiated flow) grants access outright.
    const proposal = await db.campaignProposal.findFirst({
      where: {
        campaignId,
        creatorUserId: session.creatorUserId,
        status: "ACCEPTED",
      },
    });

    // Get campaign to find orgId — and the currency, which is the campaign's.
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { orgId: true, currency: true },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // Find org-side Creator matching this CreatorUser by handle. Normalised
    // (case/@-insensitive, deleted rows excluded) so it agrees with the row
    // lib/marketplace/join.ts resolves; exact equality missed "@handle" rows.
    const creator = await findCreatorInOrgForHandle(campaign.orgId, session.handle);

    // Fallback authorization: a joined marketplace Activation (Whop-style
    // content-rewards flow) also grants access.
    const activation =
      !proposal && creator && typeof db.activation?.findFirst === "function"
        ? await db.activation.findFirst({
            where: { campaignId, creatorId: creator.id, deletedAt: null },
            select: { id: true },
          })
        : null;

    if (!proposal && !activation) {
      return NextResponse.json(
        { error: "No accepted proposal for this campaign" },
        { status: 403 }
      );
    }

    /* One open request at a time. Nothing stopped a creator posting the same
       request in a loop: fifty PENDING rows for the same campaign, each one a
       separate item on the agency's payouts queue, and approving two of them
       pays twice. */
    const openRequest = await db.payoutRequest.findFirst({
      where: {
        campaignId,
        creatorUserId: session.creatorUserId,
        status: "PENDING",
      },
      select: { id: true },
    });
    if (openRequest) {
      return NextResponse.json(
        { error: "You already have a payout request pending for this campaign" },
        { status: 409 }
      );
    }

    /* Entitlement. `requestedAmount` was any positive float and nothing ever
       compared it to what the creator had actually earned — a creator could ask
       for a million on a campaign that owed them nothing, and the only thing
       standing between that and a payment was somebody noticing.
     
       Two flows accrue on the same campaign and both count:
        - marketplace: APPROVED posts, per-1k-view rates (computeCreatorEarnings,
          MINOR units, so /100 to reach the major units this row stores);
        - negotiated: the flat rate on an ACCEPTED proposal.
       A campaign is in practice one or the other, and summing is right when it
       is somehow both — they pay for different work. */
    const earnings = await computeCreatorEarnings(session);
    const marketplaceMajor =
      (earnings.find((e) => e.campaignId === campaignId)?.approvedMinor ?? 0) / 100;
    const proposalMajor = proposal?.proposedRate ?? 0;
    const entitledMajor = round2(marketplaceMajor + proposalMajor);

    /* Already spoken for: anything still PENDING (none, checked above) or
       already APPROVED. Without this, a creator could drain the same
       entitlement once per approved request. */
    const priorRequests = await db.payoutRequest.findMany({
      where: {
        campaignId,
        creatorUserId: session.creatorUserId,
        status: { in: ["PENDING", "APPROVED"] },
      },
      select: { requestedAmount: true },
    });
    const claimedMajor = round2(priorRequests.reduce((sum, r) => sum + r.requestedAmount, 0));
    const availableMajor = round2(entitledMajor - claimedMajor);

    if (availableMajor <= 0) {
      return NextResponse.json(
        { error: "You have no approved earnings available to withdraw on this campaign" },
        { status: 400 }
      );
    }
    if (round2(requestedAmount) > availableMajor) {
      return NextResponse.json(
        {
          error: `You can request at most ${availableMajor} ${campaign.currency} on this campaign`,
          availableAmount: availableMajor,
          currency: campaign.currency,
        },
        { status: 400 }
      );
    }

    // Use found creator or a placeholder
    const creatorId = creator?.id ?? session.creatorUserId;

    const payoutRequest = await db.payoutRequest.create({
      data: {
        orgId: campaign.orgId,
        campaignId,
        creatorId,
        creatorUserId: session.creatorUserId,
        requestedAmount: round2(requestedAmount),
        // The campaign's currency, never the caller's.
        currency: campaign.currency,
      },
      include: {
        campaign: { select: { title: true } },
      },
    });

    return NextResponse.json(payoutRequest, { status: 201 });
  } catch (error) {
    console.error("Failed to create payout request:", error);
    return NextResponse.json({ error: "Failed to create payout request" }, { status: 500 });
  }
}
