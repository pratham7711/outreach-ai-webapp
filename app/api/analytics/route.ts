import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const [posts, payouts, campaigns, creators] = await Promise.all([
    // All posts in this org (via campaign relation)
    db.post.findMany({
      where: { campaign: { orgId, deletedAt: null } },
      select: {
        viewsCount: true,
        likesCount: true,
        commentsCount: true,
        engagementRate: true,
        createdAt: true,
        creatorId: true,
        creator: { select: { id: true, name: true, handle: true, avatarUrl: true } },
      },
    }),
    // Successful payouts
    db.payout.findMany({
      where: { orgId, status: "SUCCESS" },
      select: { amount: true, creatorId: true, createdAt: true },
    }),
    // Campaigns grouped by month
    db.campaign.findMany({
      where: { orgId, deletedAt: null, createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true, status: true },
      orderBy: { createdAt: "asc" },
    }),
    // Top creators by follower count for leaderboard
    db.creator.findMany({
      where: { orgId },
      select: { id: true, name: true, handle: true, platform: true, avatarUrl: true, followersCount: true },
    }),
  ]);

  // ── Org-level KPIs ──────────────────────────────────────────────────────────
  const totalViews = posts.reduce((s, p) => s + p.viewsCount, 0);
  const totalLikes = posts.reduce((s, p) => s + p.likesCount, 0);
  const totalComments = posts.reduce((s, p) => s + p.commentsCount, 0);
  const totalSpend = payouts.reduce((s, p) => s + p.amount, 0);
  const avgEngagementRate =
    posts.length > 0
      ? posts.reduce((s, p) => s + p.engagementRate, 0) / posts.length
      : 0;
  const avgCPM =
    totalViews > 0 ? (totalSpend / totalViews) * 1000 : 0;

  // ── Monthly campaign trend (last 6 months) ──────────────────────────────────
  const trendMap: Record<string, { month: string; campaigns: number; active: number }> = {};
  // Pre-fill all 6 months with 0
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.toISOString().slice(0, 7);
    const label = d.toLocaleString("default", { month: "short", year: "2-digit" });
    trendMap[key] = { month: label, campaigns: 0, active: 0 };
  }
  for (const c of campaigns) {
    const key = c.createdAt.toISOString().slice(0, 7);
    if (trendMap[key]) {
      trendMap[key].campaigns += 1;
      if (c.status === "IN_PROGRESS") trendMap[key].active += 1;
    }
  }
  const monthlyTrend = Object.values(trendMap);

  // ── Creator leaderboard (top 10 by total views from posts) ─────────────────
  const creatorViewMap: Record<string, { views: number; likes: number; posts: number; earnings: number }> = {};
  for (const p of posts) {
    if (!creatorViewMap[p.creatorId]) creatorViewMap[p.creatorId] = { views: 0, likes: 0, posts: 0, earnings: 0 };
    creatorViewMap[p.creatorId].views += p.viewsCount;
    creatorViewMap[p.creatorId].likes += p.likesCount;
    creatorViewMap[p.creatorId].posts += 1;
  }
  for (const p of payouts) {
    if (p.creatorId && creatorViewMap[p.creatorId]) {
      creatorViewMap[p.creatorId].earnings += p.amount;
    }
  }

  const creatorIndex = Object.fromEntries(creators.map((c) => [c.id, c]));
  const leaderboard = Object.entries(creatorViewMap)
    .map(([creatorId, stats]) => ({
      id: creatorId,
      name: creatorIndex[creatorId]?.name ?? "Unknown",
      handle: creatorIndex[creatorId]?.handle ?? "",
      platform: creatorIndex[creatorId]?.platform ?? "",
      avatarUrl: creatorIndex[creatorId]?.avatarUrl ?? null,
      followersCount: creatorIndex[creatorId]?.followersCount ?? 0,
      ...stats,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  // ── Platform breakdown ──────────────────────────────────────────────────────
  const platformMap: Record<string, { views: number; posts: number }> = {};
  for (const p of posts) {
    const pl = (p as any).creator?.platform ?? "UNKNOWN";
    if (!platformMap[pl]) platformMap[pl] = { views: 0, posts: 0 };
    platformMap[pl].views += p.viewsCount;
    platformMap[pl].posts += 1;
  }
  const platformBreakdown = Object.entries(platformMap).map(([platform, stats]) => ({
    platform,
    ...stats,
  }));

  return NextResponse.json({
    kpis: {
      totalViews,
      totalLikes,
      totalComments,
      totalSpend,
      avgEngagementRate: parseFloat(avgEngagementRate.toFixed(2)),
      avgCPM: parseFloat(avgCPM.toFixed(2)),
      totalPosts: posts.length,
      totalPayouts: payouts.length,
    },
    monthlyTrend,
    leaderboard,
    platformBreakdown,
  });
}
