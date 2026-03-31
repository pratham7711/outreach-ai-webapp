import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { z } from "zod";

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

const postSchema = z.object({
  campaignId: z.string().min(1),
  requestedAmount: z.number().positive(),
  currency: z.string().optional(),
});

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

    const { campaignId, requestedAmount, currency } = parsed.data;

    // Verify creator has an ACCEPTED proposal for this campaign
    const proposal = await db.campaignProposal.findFirst({
      where: {
        campaignId,
        creatorUserId: session.creatorUserId,
        status: "ACCEPTED",
      },
    });

    if (!proposal) {
      return NextResponse.json({ error: "No accepted proposal for this campaign" }, { status: 403 });
    }

    // Get campaign to find orgId
    const campaign = await db.campaign.findUnique({
      where: { id: campaignId },
      select: { orgId: true },
    });

    if (!campaign) {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }

    // Find org-side Creator matching this CreatorUser by handle
    const creator = await db.creator.findFirst({
      where: { orgId: campaign.orgId, handle: session.handle },
      select: { id: true },
    });

    // Use found creator or a placeholder
    const creatorId = creator?.id ?? session.creatorUserId;

    const payoutRequest = await db.payoutRequest.create({
      data: {
        orgId: campaign.orgId,
        campaignId,
        creatorId,
        creatorUserId: session.creatorUserId,
        requestedAmount,
        currency: currency ?? "USD",
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
