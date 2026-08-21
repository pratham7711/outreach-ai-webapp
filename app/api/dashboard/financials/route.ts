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

    // Everything below aggregates in the database. This used to load every post
    // in the range, every campaign and every activation into Node and reduce
    // over them in JavaScript: 4.5 seconds of work to produce 4 KB of JSON.

    const postWhere = { campaign: { orgId }, createdAt: { gte: from, lte: to } };
    const truncUnit = granularity === "daily" ? "day" : granularity === "weekly" ? "week" : "month";

    const [
      activeCampaigns,
      distinctCreators,
      bucketRows,
      byCampaign,
      byPlatform,
      byCreator,
      campaignTitles,
      topPostRows,
    ] = await Promise.all([
      db.campaign.count({ where: { orgId, deletedAt: null, status: "IN_PROGRESS" } }),
      // A creator is on the roster via an activation, whether or not a post exists.
      db.activation.findMany({
        where: { campaign: { orgId }, deletedAt: null },
        select: { creatorId: true },
        distinct: ["creatorId"],
      }),
      // Date bucketing is the one thing Prisma groupBy cannot express, so it is
      // raw SQL. truncUnit comes from a validated enum, never from user text.
      db.$queryRawUnsafe<{ bucket: Date; views: bigint }[]>(
        `SELECT date_trunc('${truncUnit}', p."createdAt") AS bucket, COALESCE(SUM(p."viewsCount"), 0) AS views
           FROM "Post" p
           JOIN "Campaign" c ON c.id = p."campaignId"
          WHERE c."orgId" = $1 AND p."createdAt" >= $2 AND p."createdAt" <= $3
          GROUP BY 1
          ORDER BY 1`,
        orgId,
        from,
        to
      ),
      db.post.groupBy({
        by: ["campaignId"],
        where: postWhere,
        _sum: { viewsCount: true },
        orderBy: { _sum: { viewsCount: "desc" } },
        take: 10,
      }),
      db.post.groupBy({
        by: ["platform"],
        where: postWhere,
        _sum: { viewsCount: true },
        _count: { _all: true },
      }),
      db.post.groupBy({
        by: ["creatorId"],
        where: postWhere,
        _sum: { viewsCount: true },
        _avg: { engagementRate: true },
        _count: { _all: true },
        orderBy: { _sum: { viewsCount: "desc" } },
        take: 10,
      }),
      db.campaign.findMany({
        where: { orgId, deletedAt: null },
        select: { id: true, title: true },
      }),
      db.post.findMany({
        where: postWhere,
        orderBy: { viewsCount: "desc" },
        take: 5,
        select: {
          id: true, postUrl: true, platform: true, viewsCount: true,
          likesCount: true, engagementRate: true,
          creator: { select: { name: true } },
          campaign: { select: { title: true } },
        },
      }),
    ]);

    const summary = {
      activeCampaigns,
      totalCreators: distinctCreators.length,
    };

    const viewsOverTime = bucketRows.map((r) => ({
      date: getDateKey(new Date(r.bucket), granularity),
      views: Number(r.views),
    }));

    const titleById = new Map(campaignTitles.map((c) => [c.id, c.title]));

    // Creator counts per campaign, for the campaigns that actually charted.
    const topCampaignIds = byCampaign.map((c) => c.campaignId);
    const campaignCreatorRows = topCampaignIds.length
      ? await db.activation.findMany({
          where: { campaignId: { in: topCampaignIds }, deletedAt: null },
          select: { campaignId: true, creatorId: true },
          distinct: ["campaignId", "creatorId"],
        })
      : [];
    const creatorsPerCampaign = new Map<string, number>();
    for (const row of campaignCreatorRows) {
      creatorsPerCampaign.set(row.campaignId, (creatorsPerCampaign.get(row.campaignId) ?? 0) + 1);
    }

    const viewsByCampaign = byCampaign.map((c) => ({
      campaignId: c.campaignId,
      title: titleById.get(c.campaignId) ?? "Unknown campaign",
      views: c._sum.viewsCount ?? 0,
      creatorsCount: creatorsPerCampaign.get(c.campaignId) ?? 0,
    }));

    const platformBreakdown = byPlatform.map((p) => ({
      platform: p.platform,
      views: p._sum.viewsCount ?? 0,
      postsCount: p._count._all,
    }));

    const creatorIds = byCreator.map((c) => c.creatorId);
    const creatorRows = creatorIds.length
      ? await db.creator.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, name: true, handle: true, _count: { select: { activations: true } } },
        })
      : [];
    const creatorById = new Map(creatorRows.map((c) => [c.id, c]));

    const creatorPerformance = byCreator.map((c) => {
      const creator = creatorById.get(c.creatorId);
      return {
        creatorId: c.creatorId,
        name: creator?.name ?? "Unknown",
        handle: creator?.handle ?? "",
        activationCount: creator?._count.activations ?? 0,
        views: c._sum.viewsCount ?? 0,
        avgEngagement: Math.round((c._avg.engagementRate ?? 0) * 100) / 100,
      };
    });

    const topPosts = topPostRows.map((p) => ({
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
