import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { computeCampaignEmv, computeEngagementRate, sumEngagements } from "@/lib/metrics";

const PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"] as const;

function parseFrom(req: NextRequest): Date | null {
  const raw = req.nextUrl.searchParams.get("from");
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function parsePlatform(req: NextRequest): string | null {
  const raw = req.nextUrl.searchParams.get("platform");
  if (!raw || raw === "ALL") return null;
  return (PLATFORMS as readonly string[]).includes(raw) ? raw : null;
}

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const from = parseFrom(req);
  const platform = parsePlatform(req);

  const postWhere: any = { campaign: { orgId, deletedAt: null } };
  if (platform) postWhere.platform = platform;
  if (from) postWhere.postedAt = { gte: from };

  const payoutWhere: any = { orgId, status: "SUCCESS" };
  if (from) payoutWhere.createdAt = { gte: from };

  const now = new Date();
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const [posts, payouts, campaigns, creators, orgCampaigns] = await Promise.all([
    db.post.findMany({
      where: postWhere,
      select: {
        campaignId: true,
        platform: true,
        viewsCount: true,
        likesCount: true,
        commentsCount: true,
        sharesCount: true,
        savesCount: true,
        engagementRate: true,
        postedAt: true,
        creatorId: true,
        creator: { select: { id: true, name: true, handle: true, avatarUrl: true, platform: true } },
      },
    }),
    db.payout.findMany({
      where: payoutWhere,
      select: { amount: true, creatorId: true, createdAt: true },
    }),
    db.campaign.findMany({
      where: { orgId, deletedAt: null, createdAt: { gte: sixMonthsAgo } },
      select: { createdAt: true, status: true },
      orderBy: { createdAt: "asc" },
    }),
    db.creator.findMany({
      where: { orgId },
      select: { id: true, name: true, handle: true, platform: true, avatarUrl: true, followersCount: true },
    }),
    db.campaign.findMany({
      where: { orgId, deletedAt: null },
      select: { id: true, title: true, status: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const totalViews = posts.reduce((s, p) => s + p.viewsCount, 0);
  const totalLikes = posts.reduce((s, p) => s + p.likesCount, 0);
  const totalComments = posts.reduce((s, p) => s + p.commentsCount, 0);
  const totalSpend = payouts.reduce((s, p) => s + p.amount, 0);
  const avgEngagementRate =
    posts.length > 0 ? posts.reduce((s, p) => s + p.engagementRate, 0) / posts.length : 0;
  const avgCPM = totalViews > 0 ? (totalSpend / totalViews) * 1000 : 0;

  const trendMap: Record<string, { month: string; campaigns: number; active: number }> = {};
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

  type Agg = {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    posts: number;
    earnings: number;
    campaignIds: Set<string>;
    emvPosts: { platform: string; views: number; likes: number; comments: number; shares: number; saves: number }[];
  };
  const creatorAgg: Record<string, Agg> = {};
  for (const p of posts) {
    const a =
      creatorAgg[p.creatorId] ??
      (creatorAgg[p.creatorId] = {
        views: 0, likes: 0, comments: 0, shares: 0, saves: 0, posts: 0, earnings: 0,
        campaignIds: new Set<string>(), emvPosts: [],
      });
    a.views += p.viewsCount;
    a.likes += p.likesCount;
    a.comments += p.commentsCount;
    a.shares += p.sharesCount;
    a.saves += p.savesCount;
    a.posts += 1;
    a.campaignIds.add(p.campaignId);
    a.emvPosts.push({
      platform: p.platform,
      views: p.viewsCount,
      likes: p.likesCount,
      comments: p.commentsCount,
      shares: p.sharesCount,
      saves: p.savesCount,
    });
  }
  for (const p of payouts) {
    if (p.creatorId && creatorAgg[p.creatorId]) creatorAgg[p.creatorId].earnings += p.amount;
  }

  const creatorIndex = Object.fromEntries(creators.map((c) => [c.id, c]));
  const leaderboard = Object.entries(creatorAgg)
    .map(([creatorId, a]) => {
      const engagements = sumEngagements({ likes: a.likes, comments: a.comments, shares: a.shares, saves: a.saves });
      const engRate = computeEngagementRate({
        views: a.views, likes: a.likes, comments: a.comments, shares: a.shares, saves: a.saves,
      });
      return {
        id: creatorId,
        name: creatorIndex[creatorId]?.name ?? "Unknown",
        handle: creatorIndex[creatorId]?.handle ?? "",
        platform: creatorIndex[creatorId]?.platform ?? "",
        avatarUrl: creatorIndex[creatorId]?.avatarUrl ?? null,
        followersCount: creatorIndex[creatorId]?.followersCount ?? 0,
        campaigns: a.campaignIds.size,
        views: a.views,
        likes: a.likes,
        posts: a.posts,
        earnings: a.earnings,
        engagements,
        engagementRate: engRate ?? 0,
        emv: computeCampaignEmv(a.emvPosts),
      };
    })
    .sort((a, b) => b.views - a.views)
    .slice(0, 20);

  const platformMap: Record<string, { views: number; posts: number }> = {};
  for (const p of posts) {
    const pl = p.platform ?? "UNKNOWN";
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
    campaigns: orgCampaigns,
  });
}
