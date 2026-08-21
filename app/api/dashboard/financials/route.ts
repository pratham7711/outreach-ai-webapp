import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { READ_CACHE_HEADERS } from "@/lib/http/readCache";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { dateParam, parseQuery } from "@/lib/http/queryParams";

const performanceQuerySchema = z.object({
  from: dateParam.optional(),
  to: dateParam.optional(),
  granularity: z.enum(["daily", "weekly", "monthly"]).default("monthly"),
});

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

/*
  Campaign delivery, not money. Payments are not part of the product right now,
  so this reports views, posts, creators and engagement. The route keeps its
  path because callers and tests reference it.
*/

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

    const parsedQuery = parseQuery(performanceQuerySchema, searchParams);
    if (!parsedQuery.ok) return parsedQuery.response;
    const from = parsedQuery.data.from ?? sixMonthsAgo;
    const to = parsedQuery.data.to ?? now;
    const granularity = parsedQuery.data.granularity;

    // ── Parallel data fetches ───────────────────────────────────────────────

    const [posts, campaigns, activations] = await Promise.all([
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
        select: { id: true, title: true, status: true },
      }),
      db.activation.findMany({
        where: { campaign: { orgId }, deletedAt: null },
        select: { id: true, campaignId: true, creatorId: true, creator: { select: { name: true, handle: true } } },
      }),
    ]);

    // ── 1. Summary ──────────────────────────────────────────────────────────

    // Creator count comes from activations, not payouts: a creator is on the
    // campaign whether or not anyone has been paid.
    const activeCampaigns = campaigns.filter((c) => c.status === "IN_PROGRESS").length;
    const totalCreators = new Set(activations.map((a) => a.creatorId)).size;

    const summary = {
      activeCampaigns,
      totalCreators,
    };

    // ── 2. Views Over Time ──────────────────────────────────────────────────

    const viewsByDate = new Map<string, number>();

    for (const post of posts) {
      const key = getDateKey(new Date(post.createdAt), granularity);
      viewsByDate.set(key, (viewsByDate.get(key) ?? 0) + post.viewsCount);
    }

    const viewsOverTime = Array.from(viewsByDate.entries())
      .map(([date, views]) => ({ date, views }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // ── 3. Views By Campaign (top 10) ───────────────────────────────────────

    // Seeded from every campaign, so one with posts but no payments still
    // charts -- the old payout-keyed version dropped it entirely.
    const campaignViewsMap = new Map<string, { title: string; views: number; creators: Set<string> }>();

    for (const c of campaigns) {
      campaignViewsMap.set(c.id, { title: c.title, views: 0, creators: new Set<string>() });
    }

    for (const post of posts) {
      const entry = campaignViewsMap.get(post.campaignId);
      if (entry) entry.views += post.viewsCount;
    }

    for (const a of activations) {
      const entry = campaignViewsMap.get(a.campaignId);
      if (entry) entry.creators.add(a.creatorId);
    }

    const viewsByCampaign = Array.from(campaignViewsMap.entries())
      .map(([campaignId, data]) => ({
        campaignId,
        title: data.title,
        views: data.views,
        creatorsCount: data.creators.size,
      }))
      .filter((c) => c.views > 0 || c.creatorsCount > 0)
      .sort((a, b) => b.views - a.views)
      .slice(0, 10);

    // ── 4. Platform Breakdown ───────────────────────────────────────────────

    const platformMap = new Map<string, { views: number; postsCount: number }>();

    for (const post of posts) {
      const entry = platformMap.get(post.platform) ?? { views: 0, postsCount: 0 };
      entry.views += post.viewsCount;
      entry.postsCount += 1;
      platformMap.set(post.platform, entry);
    }

    const platformBreakdown = Array.from(platformMap.entries()).map(([platform, data]) => ({
      platform,
      views: data.views,
      postsCount: data.postsCount,
    }));

    // ── 5. Creator Performance (top 10 by views) ────────────────────────────

    const creatorMap = new Map<string, { name: string; handle: string; activationIds: Set<string>; views: number; engagementSum: number; postCount: number }>();

    for (const a of activations) {
      if (!a.creator) continue;
      const entry = creatorMap.get(a.creatorId) ?? {
        name: a.creator.name,
        handle: a.creator.handle,
        activationIds: new Set<string>(),
        views: 0,
        engagementSum: 0,
        postCount: 0,
      };
      entry.activationIds.add(a.id);
      creatorMap.set(a.creatorId, entry);
    }

    for (const post of posts) {
      let entry = creatorMap.get(post.creatorId);
      if (!entry && post.creator) {
        entry = {
          name: post.creator.name,
          handle: post.creator.handle,
          activationIds: new Set<string>(),
          views: 0,
          engagementSum: 0,
          postCount: 0,
        };
        creatorMap.set(post.creatorId, entry);
      }
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
        activationCount: data.activationIds.size,
        views: data.views,
        avgEngagement: data.postCount > 0 ? Math.round((data.engagementSum / data.postCount) * 100) / 100 : 0,
      }))
      .sort((a, b) => b.views - a.views)
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
      viewsOverTime,
      viewsByCampaign,
      platformBreakdown,
      creatorPerformance,
      topPosts,
    }, { headers: READ_CACHE_HEADERS });
  } catch (error) {
    console.error("Dashboard performance error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
