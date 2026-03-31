import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

interface ViewBasedConfig {
  ratePerThousandViews: number;
  capAmount: number;
  trackingWindowDays: number;
  minimumViewsForPayout: number;
}

// GET /api/campaigns/[id]/payout-calculator
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

    // Get all ledger entries grouped by creator
    const entries = await db.viewLedger.findMany({
      where: { campaignId, orgId },
      orderBy: { recordedAt: "desc" },
    });

    // Get unique creator IDs and fetch their details
    const creatorIds = [...new Set(entries.map((e) => e.creatorId))];
    const creators = await db.creator.findMany({
      where: { id: { in: creatorIds }, orgId },
      select: { id: true, name: true, handle: true, avatarUrl: true },
    });
    const creatorLookup = new Map(creators.map((c) => [c.id, c]));

    // Build per-creator summary
    const creatorSummaries: {
      creatorId: string;
      name: string;
      handle: string;
      avatarUrl: string | null;
      totalViews: number;
      totalEarned: number;
      isCapped: boolean;
      posts: {
        postId: string;
        viewsRecorded: number;
        totalDelta: number;
        totalEarned: number;
      }[];
    }[] = [];

    // Group entries by creator
    const byCreator = new Map<string, typeof entries>();
    for (const entry of entries) {
      const existing = byCreator.get(entry.creatorId) ?? [];
      existing.push(entry);
      byCreator.set(entry.creatorId, existing);
    }

    let campaignTotal = 0;

    for (const [creatorId, creatorEntries] of byCreator) {
      const creator = creatorLookup.get(creatorId);
      const totalViews = creatorEntries.reduce((s, e) => s + e.viewsDelta, 0);
      const totalEarned = creatorEntries.reduce((s, e) => s + e.amountEarned, 0);
      const isCapped = creatorEntries.some((e) => e.isCapped);

      // Group by post
      const byPost = new Map<
        string,
        { viewsRecorded: number; totalDelta: number; totalEarned: number }
      >();
      for (const entry of creatorEntries) {
        const existing = byPost.get(entry.postId) ?? {
          viewsRecorded: 0,
          totalDelta: 0,
          totalEarned: 0,
        };
        // Keep the latest viewsRecorded
        if (entry.viewsRecorded > existing.viewsRecorded) {
          existing.viewsRecorded = entry.viewsRecorded;
        }
        existing.totalDelta += entry.viewsDelta;
        existing.totalEarned += entry.amountEarned;
        byPost.set(entry.postId, existing);
      }

      creatorSummaries.push({
        creatorId,
        name: creator?.name ?? "Unknown",
        handle: creator?.handle ?? "unknown",
        avatarUrl: creator?.avatarUrl ?? null,
        totalViews,
        totalEarned,
        isCapped,
        posts: Array.from(byPost.entries()).map(([postId, data]) => ({
          postId,
          ...data,
        })),
      });

      campaignTotal += totalEarned;
    }

    const budget = campaign.budget ?? 0;

    return NextResponse.json({
      campaignId,
      creators: creatorSummaries,
      campaignTotal,
      budget,
      remainingBudget: budget - campaignTotal,
    });
  } catch (error) {
    console.error("Failed to calculate payouts:", error);
    return NextResponse.json(
      { error: "Failed to calculate payouts" },
      { status: 500 }
    );
  }
}
