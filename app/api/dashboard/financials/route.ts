import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDateKey(date: Date, granularity: string): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  if (granularity === "daily") return `${y}-${m}-${d}`;
  if (granularity === "weekly") {
    // ISO week number
    const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    const weekNo = String(Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)).padStart(2, "0");
    return `${tmp.getUTCFullYear()}-W${weekNo}`;
  }
  // monthly
  return `${y}-${m}`;
}

// ─── GET /api/dashboard/financials ────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const orgId = (session.user as any).orgId;

    const { searchParams } = req.nextUrl;
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : sixMonthsAgo;
    const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : now;
    const granularity = searchParams.get("granularity") ?? "monthly";

    // ── Parallel data fetches ───────────────────────────────────────────────

    const [payouts, posts, campaigns, activations, deposits, allCampaigns] = await Promise.all([
      db.payout.findMany({
        where: { orgId, createdAt: { gte: from, lte: to } },
        include: {
          creator: { select: { id: true, name: true, handle: true, platform: true } },
          campaign: { select: { id: true, title: true, budget: true } },
        },
      }),
      db.post.findMany({
        where: {
          campaign: { orgId },
          createdAt: { gte: from, lte: to },
        },
        include: {
          creator: { select: { id: true, name: true, handle: true } },
          campaign: { select: { id: true, title: true } },
        },
      }),
      db.campaign.findMany({
        where: { orgId, deletedAt: null },
        select: { id: true, title: true, budget: true, status: true },
      }),
      db.activation.findMany({
        where: { campaign: { orgId }, deletedAt: null },
        select: { id: true, campaignId: true, creatorId: true },
      }),
      db.campaignDeposit.findMany({
        where: { orgId },
        select: { amountUsd: true, releasedAmount: true },
      }),
      // All campaigns for budget total (not date-filtered)
      db.campaign.findMany({
        where: { orgId, deletedAt: null },
        select: { budget: true },
      }),
    ]);

    // ── 1. Summary ──────────────────────────────────────────────────────────

    const completedPayouts = payouts.filter((p) => p.status === "SUCCESS");
    const pendingPayouts = payouts.filter((p) => p.status === "PENDING");

    const totalSpend = completedPayouts.reduce((sum, p) => sum + p.amount, 0);
    const totalBudget = allCampaigns.reduce((sum, c) => sum + (c.budget ?? 0), 0);
    const budgetUtilization = totalBudget > 0 ? (totalSpend / totalBudget) * 100 : 0;
    const activeCampaigns = campaigns.filter((c) => c.status === "IN_PROGRESS").length;
    const uniqueCreatorIds = new Set(completedPayouts.map((p) => p.creatorId));
    const totalCreators = uniqueCreatorIds.size;
    const avgCampaignSpend = activeCampaigns > 0 ? totalSpend / activeCampaigns : 0;
    const pendingPayoutsAmount = pendingPayouts.reduce((sum, p) => sum + p.amount, 0);
    const totalDeposits = deposits.reduce((sum, d) => sum + d.amountUsd, 0);
    const releasedDeposits = deposits.reduce((sum, d) => sum + d.releasedAmount, 0);

    const summary = {
      totalSpend,
      totalBudget,
      budgetUtilization: Math.round(budgetUtilization * 100) / 100,
      activeCampaigns,
      totalCreators,
      avgCampaignSpend: Math.round(avgCampaignSpend * 100) / 100,
      pendingPayouts: pendingPayoutsAmount,
      totalDeposits,
      releasedDeposits,
    };

    // ── 2. Spend Over Time ──────────────────────────────────────────────────

    const spendByDate = new Map<string, { spend: number; views: number }>();

    for (const p of completedPayouts) {
      const key = getDateKey(new Date(p.createdAt), granularity);
      const entry = spendByDate.get(key) ?? { spend: 0, views: 0 };
      entry.spend += p.amount;
      spendByDate.set(key, entry);
    }

    for (const post of posts) {
      const key = getDateKey(new Date(post.createdAt), granularity);
      const entry = spendByDate.get(key) ?? { spend: 0, views: 0 };
      entry.views += post.viewsCount;
      spendByDate.set(key, entry);
    }

    const spendOverTime = Array.from(spendByDate.entries())
      .map(([date, data]) => ({ date, spend: data.spend, views: data.views }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── 3. Spend By Campaign (top 10) ───────────────────────────────────────

    const campaignSpendMap = new Map<string, { title: string; spend: number; budget: number; views: number; creators: Set<string> }>();

    for (const p of completedPayouts) {
      if (!p.campaignId || !p.campaign) continue;
      const entry = campaignSpendMap.get(p.campaignId) ?? {
        title: p.campaign.title,
        spend: 0,
        budget: p.campaign.budget ?? 0,
        views: 0,
        creators: new Set<string>(),
      };
      entry.spend += p.amount;
      entry.creators.add(p.creatorId);
      campaignSpendMap.set(p.campaignId, entry);
    }

    for (const post of posts) {
      const entry = campaignSpendMap.get(post.campaignId);
      if (entry) entry.views += post.viewsCount;
    }

    // Add creator counts from activations for campaigns that may not have payouts
    for (const a of activations) {
      const entry = campaignSpendMap.get(a.campaignId);
      if (entry) entry.creators.add(a.creatorId);
    }

    const spendByCampaign = Array.from(campaignSpendMap.entries())
      .map(([campaignId, data]) => ({
        campaignId,
        title: data.title,
        spend: data.spend,
        budget: data.budget,
        views: data.views,
        creatorsCount: data.creators.size,
      }))
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 10);

    // ── 4. Platform Breakdown ───────────────────────────────────────────────

    const platformMap = new Map<string, { spend: number; views: number; postsCount: number }>();

    for (const post of posts) {
      const entry = platformMap.get(post.platform) ?? { spend: 0, views: 0, postsCount: 0 };
      entry.views += post.viewsCount;
      entry.postsCount += 1;
      platformMap.set(post.platform, entry);
    }

    // Attribute payout spend to platform via creator's platform
    for (const p of completedPayouts) {
      if (!p.creator) continue;
      const platform = p.creator.platform;
      const entry = platformMap.get(platform) ?? { spend: 0, views: 0, postsCount: 0 };
      entry.spend += p.amount;
      platformMap.set(platform, entry);
    }

    const platformBreakdown = Array.from(platformMap.entries()).map(([platform, data]) => ({
      platform,
      spend: data.spend,
      views: data.views,
      postsCount: data.postsCount,
    }));

    // ── 5. Creator Performance (top 10 by total paid) ───────────────────────

    const creatorMap = new Map<string, { name: string; handle: string; totalPaid: number; activationIds: Set<string>; views: number; engagementSum: number; postCount: number }>();

    for (const p of completedPayouts) {
      if (!p.creator) continue;
      const entry = creatorMap.get(p.creatorId) ?? {
        name: p.creator.name,
        handle: p.creator.handle,
        totalPaid: 0,
        activationIds: new Set<string>(),
        views: 0,
        engagementSum: 0,
        postCount: 0,
      };
      entry.totalPaid += p.amount;
      creatorMap.set(p.creatorId, entry);
    }

    // Enrich with activation counts
    for (const a of activations) {
      const entry = creatorMap.get(a.creatorId);
      if (entry) entry.activationIds.add(a.id);
    }

    // Enrich with post metrics
    for (const post of posts) {
      const entry = creatorMap.get(post.creatorId);
      if (entry) {
        entry.views += post.viewsCount;
        entry.engagementSum += post.engagementRate;
        entry.postCount += 1;
      }
    }

    const creatorPerformance = Array.from(creatorMap.entries())
      .map(([creatorId, data]) => ({
        creatorId,
        name: data.name,
        handle: data.handle,
        totalPaid: data.totalPaid,
        activationCount: data.activationIds.size,
        views: data.views,
        avgEngagement: data.postCount > 0 ? Math.round((data.engagementSum / data.postCount) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.totalPaid - a.totalPaid)
      .slice(0, 10);

    // ── 6. Top Posts (top 5 by views) ───────────────────────────────────────

    const topPosts = posts
      .sort((a, b) => b.viewsCount - a.viewsCount)
      .slice(0, 5)
      .map((p) => ({
        id: p.id,
        postUrl: p.postUrl,
        platform: p.platform,
        viewsCount: p.viewsCount,
        likesCount: p.likesCount,
        engagementRate: p.engagementRate,
        creatorName: p.creator?.name ?? null,
        campaignTitle: p.campaign?.title ?? null,
      }));

    // ── Response ────────────────────────────────────────────────────────────

    return NextResponse.json({
      summary,
      spendOverTime,
      spendByCampaign,
      platformBreakdown,
      creatorPerformance,
      topPosts,
    });
  } catch (error) {
    console.error("Dashboard financials error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
