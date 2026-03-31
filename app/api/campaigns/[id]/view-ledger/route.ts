import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// ---------- Types for campaign typeConfig ----------
interface ViewBasedConfig {
  ratePerThousandViews: number;
  capAmount: number;
  trackingWindowDays: number;
  minimumViewsForPayout: number;
}

// ---------- GET /api/campaigns/[id]/view-ledger ----------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;

    // Verify campaign belongs to org
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null },
    });
    if (!campaign)
      return NextResponse.json({ error: "Campaign not found" }, { status: 403 });

    const entries = await db.viewLedger.findMany({
      where: { campaignId, orgId },
      orderBy: { recordedAt: "desc" },
    });

    // Group by creator
    const creatorMap: Record<
      string,
      {
        creatorId: string;
        totalViews: number;
        totalEarned: number;
        isCapped: boolean;
        entries: typeof entries;
      }
    > = {};

    for (const entry of entries) {
      if (!creatorMap[entry.creatorId]) {
        creatorMap[entry.creatorId] = {
          creatorId: entry.creatorId,
          totalViews: 0,
          totalEarned: 0,
          isCapped: false,
          entries: [],
        };
      }
      const group = creatorMap[entry.creatorId];
      group.totalViews += entry.viewsDelta;
      group.totalEarned += entry.amountEarned;
      if (entry.isCapped) group.isCapped = true;
      group.entries.push(entry);
    }

    return NextResponse.json({
      campaignId,
      creators: Object.values(creatorMap),
      totalEntries: entries.length,
    });
  } catch (error) {
    console.error("Failed to fetch view ledger:", error);
    return NextResponse.json(
      { error: "Failed to fetch view ledger" },
      { status: 500 }
    );
  }
}

// ---------- POST /api/campaigns/[id]/view-ledger ----------
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId } = await params;

    // Verify campaign belongs to org and is VIEW_BASED
    const campaign = await db.campaign.findFirst({
      where: { id: campaignId, orgId, deletedAt: null },
    });
    if (!campaign)
      return NextResponse.json({ error: "Campaign not found" }, { status: 403 });

    if (campaign.campaignType !== "VIEW_BASED") {
      return NextResponse.json(
        { error: "Campaign is not VIEW_BASED" },
        { status: 400 }
      );
    }

    const typeConfig = campaign.typeConfig as ViewBasedConfig | null;
    if (!typeConfig) {
      return NextResponse.json(
        { error: "Campaign has no typeConfig" },
        { status: 400 }
      );
    }

    const {
      ratePerThousandViews = 0,
      capAmount = Infinity,
      minimumViewsForPayout = 0,
    } = typeConfig;

    // Get all activations with their posts
    const activations = await db.activation.findMany({
      where: { campaignId, deletedAt: null },
      include: {
        posts: { select: { id: true, viewsCount: true, activationId: true, creatorId: true } },
        creator: { select: { id: true, name: true, handle: true } },
      },
    });

    const created: any[] = [];

    for (const activation of activations) {
      for (const post of activation.posts) {
        // Find last ledger entry for this post
        const lastEntry = await db.viewLedger.findFirst({
          where: { postId: post.id, campaignId, orgId },
          orderBy: { recordedAt: "desc" },
        });

        const previousViews = lastEntry?.viewsRecorded ?? 0;
        const viewsDelta = post.viewsCount - previousViews;

        // Skip if no new views
        if (viewsDelta <= 0) continue;

        // Get cumulative earned for this activation
        const cumulativeEntries = await db.viewLedger.aggregate({
          where: { activationId: activation.id, orgId },
          _sum: { amountEarned: true },
        });
        const previousCumulative = cumulativeEntries._sum.amountEarned ?? 0;

        // Calculate raw earnings
        let rawEarned = (viewsDelta / 1000) * ratePerThousandViews;

        // Check minimum views threshold for the post
        const totalPostViews = post.viewsCount;
        if (totalPostViews < minimumViewsForPayout) {
          rawEarned = 0;
        }

        // Check cap
        let isCapped = false;
        let finalEarned = rawEarned;
        const newCumulative = previousCumulative + rawEarned;

        if (newCumulative > capAmount) {
          finalEarned = Math.max(0, capAmount - previousCumulative);
          isCapped = true;
        }

        const entry = await db.viewLedger.create({
          data: {
            orgId,
            campaignId,
            creatorId: post.creatorId,
            activationId: activation.id,
            postId: post.id,
            viewsRecorded: post.viewsCount,
            viewsDelta,
            cpmRate: ratePerThousandViews,
            amountEarned: finalEarned,
            cumulativeEarned: previousCumulative + finalEarned,
            cappedAt: capAmount === Infinity ? null : capAmount,
            isCapped,
          },
        });

        created.push(entry);
      }
    }

    return NextResponse.json({ recorded: created.length, entries: created }, { status: 201 });
  } catch (error) {
    console.error("Failed to record view ledger:", error);
    return NextResponse.json(
      { error: "Failed to record view ledger" },
      { status: 500 }
    );
  }
}
