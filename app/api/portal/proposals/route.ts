import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { z } from "zod";

const createProposalSchema = z.object({
  campaignId: z.string().min(1),
  proposedRate: z.number().positive(),
  currency: z.string().default("USD"),
});

// GET /api/portal/proposals — List my proposals
export async function GET(request: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = request.nextUrl;
    const status = searchParams.get("status");

    const where: Record<string, unknown> = { creatorUserId: session.creatorUserId };
    if (status) where.status = status;

    const proposals = await db.campaignProposal.findMany({
      where,
      include: {
        campaign: {
          select: { id: true, title: true, budget: true, currency: true, status: true, org: { select: { name: true, logoUrl: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ proposals });
  } catch (error) {
    console.error("Failed to fetch proposals:", error);
    return NextResponse.json({ error: "Failed to fetch proposals" }, { status: 500 });
  }
}

// POST /api/portal/proposals — Submit a proposal to a campaign
export async function POST(request: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const parsed = createProposalSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const { campaignId, proposedRate, currency } = parsed.data;

    // Verify campaign is open for proposals
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, enrollmentOpen: true, marketplaceVisibility: "GLOBAL", status: "IN_PROGRESS", deletedAt: null },
    });
    if (!campaign) {
      return NextResponse.json({ error: "Campaign not available for proposals" }, { status: 404 });
    }

    // Check for existing proposal
    const existing = await db.campaignProposal.findFirst({
      where: { campaignId, creatorUserId: session.creatorUserId, status: { in: ["PENDING", "ACCEPTED"] } },
    });
    if (existing) {
      return NextResponse.json({ error: "You already have an active proposal for this campaign" }, { status: 409 });
    }

    const proposal = await db.campaignProposal.create({
      data: {
        campaignId,
        creatorUserId: session.creatorUserId,
        proposedRate,
        currency,
      },
      include: {
        campaign: { select: { id: true, title: true } },
      },
    });

    return NextResponse.json(proposal, { status: 201 });
  } catch (error) {
    console.error("Failed to create proposal:", error);
    return NextResponse.json({ error: "Failed to create proposal" }, { status: 500 });
  }
}
