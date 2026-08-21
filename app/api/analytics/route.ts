import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { READ_CACHE_HEADERS } from "@/lib/http/readCache";
import { authenticateRequest } from "@/lib/authenticate";
import { computeCampaignEmv, computeEngagementRate, sumEngagements } from "@/lib/metrics";
import type { Prisma } from "@/lib/generated/prisma/client";
import { PLATFORM_VALUES } from "@/lib/platforms/constants";

const PLATFORMS = PLATFORM_VALUES;

const LEADERBOARD_SIZE = 20;

/**
 * A month slot key. Built from the calendar parts rather than toISOString,
 * which shifts a local month start back a month in any positive-offset zone —
 * in IST the six slots were labelled Mar–Aug while keyed Feb–Jul, so August's
 * campaigns matched no slot and July's were counted under "Aug".
 *
 * Everything either side of this must be UTC, and that is not cosmetic. The
 * slots used to be built from LOCAL calendar parts while the database's
 * date_trunc result was read back with getUTC*, so the two disagreed by one
 * month for the first 5h30m of every IST day: a local 1 Aug 00:07 is 31 Jul
 * 18:37 UTC. The current month's counts landed in the previous month's slot and
 * the newest slot read zero. It only ever reproduced between 18:30 and 24:00
 * UTC, which is why it survived so long. date_trunc runs in the database's zone
 * (UTC on Neon), so UTC is the correct basis on both sides.
 */
function monthKey(year: number, month: number): string {
  return `${year}-${String(month + 1).padStart(2, "0")}`;
}

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

/**
 * Every number here is counted in the database. Reading the org's whole post
 * table into Node to reduce it by hand cost ~2.1s and grew with the roster;
 * grouping by (creator, platform) keeps the rows proportional to who actually
 * posted, and EMV is linear per metric so a platform's summed counts price the
 * same as its posts priced one by one.
 */
export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const from = parseFrom(req);
  const platform = parsePlatform(req);

  const postWhere: Prisma.PostWhereInput = {
    campaign: { orgId, deletedAt: null },
    ...(platform && { platform: platform as (typeof PLATFORMS)[number] }),
    ...(from && { postedAt: { gte: from } }),
  };

  const now = new Date();
  const sixMonthsAgo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1));

  const [kpiRow, engagementRow, monthRows, creatorPlatformRows, creatorCampaignPairs, platformRows, orgCampaigns] =
    await Promise.all([
      db.post.aggregate({
        where: postWhere,
        _sum: { viewsCount: true, likesCount: true, commentsCount: true },
        _count: { _all: true },
      }),
      // engagementRate is 0 on 18,602 of 18,708 imported posts — CreatorCore's
      // export carried views but no likes, comments, shares or saves, so the
      // rate could not be computed and cannot be derived here either. Averaging
      // those in reported 0.05% for a roster whose measured posts run near 1%,
      // so the average covers only the posts that were actually measured and
      // the response says how many that is.
      db.post.aggregate({
        where: { ...postWhere, engagementRate: { gt: 0 } },
        _avg: { engagementRate: true },
        _count: { _all: true },
      }),
      // Month bucketing is the one thing Prisma groupBy cannot express.
      db.$queryRawUnsafe<{ bucket: Date; campaigns: bigint; active: bigint }[]>(
        `SELECT date_trunc('month', c."createdAt") AS bucket,
                COUNT(*) AS campaigns,
                COUNT(*) FILTER (WHERE c.status::text = 'IN_PROGRESS') AS active
           FROM "Campaign" c
          WHERE c."orgId" = $1 AND c."deletedAt" IS NULL AND c."createdAt" >= $2
          GROUP BY 1
          ORDER BY 1`,
        orgId,
        sixMonthsAgo
      ),
      db.post.groupBy({
        by: ["creatorId", "platform"],
        where: postWhere,
        _sum: {
          viewsCount: true,
          likesCount: true,
          commentsCount: true,
          sharesCount: true,
          savesCount: true,
        },
        _count: { _all: true },
      }),
      // Distinct (creator, campaign) pairs, so "campaigns" per creator does not
      // need every post row in memory.
      db.post.groupBy({ by: ["creatorId", "campaignId"], where: postWhere }),
      db.post.groupBy({
        by: ["platform"],
        where: postWhere,
        _sum: { viewsCount: true },
        _count: { _all: true },
      }),
      db.campaign.findMany({
        where: { orgId, deletedAt: null },
        select: { id: true, title: true, status: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);

  const trendMap: Record<string, { month: string; campaigns: number; active: number }> = {};
  for (let i = 5; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    trendMap[monthKey(d.getUTCFullYear(), d.getUTCMonth())] = {
      month: d.toLocaleString("default", { month: "short", year: "2-digit", timeZone: "UTC" }),
      campaigns: 0,
      active: 0,
    };
  }
  for (const row of monthRows) {
    // date_trunc returns the month start in the database's zone, so read it back
    // in UTC to land on the same calendar month the slots were built from.
    const b = new Date(row.bucket);
    const key = monthKey(b.getUTCFullYear(), b.getUTCMonth());
    if (trendMap[key]) {
      trendMap[key].campaigns = Number(row.campaigns);
      trendMap[key].active = Number(row.active);
    }
  }
  const monthlyTrend = Object.values(trendMap);

  type CreatorTotals = {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    posts: number;
    /** One entry per platform, priced together because EMV is linear. */
    emvInputs: { platform: string; views: number; likes: number; comments: number; shares: number; saves: number }[];
  };
  const totals = new Map<string, CreatorTotals>();
  for (const row of creatorPlatformRows) {
    const t =
      totals.get(row.creatorId) ??
      { views: 0, likes: 0, comments: 0, shares: 0, saves: 0, posts: 0, emvInputs: [] };
    const views = row._sum.viewsCount ?? 0;
    const likes = row._sum.likesCount ?? 0;
    const comments = row._sum.commentsCount ?? 0;
    const shares = row._sum.sharesCount ?? 0;
    const saves = row._sum.savesCount ?? 0;
    t.views += views;
    t.likes += likes;
    t.comments += comments;
    t.shares += shares;
    t.saves += saves;
    t.posts += row._count._all;
    t.emvInputs.push({ platform: row.platform, views, likes, comments, shares, saves });
    totals.set(row.creatorId, t);
  }

  const campaignsPerCreator = new Map<string, number>();
  for (const pair of creatorCampaignPairs) {
    campaignsPerCreator.set(pair.creatorId, (campaignsPerCreator.get(pair.creatorId) ?? 0) + 1);
  }

  // Rank first, then fetch profiles — only the visible 20 creators are read.
  const ranked = [...totals.entries()].sort((a, b) => b[1].views - a[1].views).slice(0, LEADERBOARD_SIZE);
  const profiles = ranked.length
    ? await db.creator.findMany({
        where: { orgId, id: { in: ranked.map(([id]) => id) } },
        select: { id: true, name: true, handle: true, platform: true, avatarUrl: true, followersCount: true },
      })
    : [];
  const profileIndex = new Map(profiles.map((c) => [c.id, c]));

  const leaderboard = ranked.map(([creatorId, t]) => {
    const profile = profileIndex.get(creatorId);
    return {
      id: creatorId,
      name: profile?.name ?? "Unknown",
      handle: profile?.handle ?? "",
      platform: profile?.platform ?? "",
      avatarUrl: profile?.avatarUrl ?? null,
      followersCount: profile?.followersCount ?? 0,
      campaigns: campaignsPerCreator.get(creatorId) ?? 0,
      views: t.views,
      likes: t.likes,
      posts: t.posts,
      engagements: sumEngagements({ likes: t.likes, comments: t.comments, shares: t.shares, saves: t.saves }),
      engagementRate:
        computeEngagementRate({
          views: t.views,
          likes: t.likes,
          comments: t.comments,
          shares: t.shares,
          saves: t.saves,
        }) ?? 0,
      emv: computeCampaignEmv(t.emvInputs),
    };
  });

  const platformBreakdown = platformRows.map((row) => ({
    platform: row.platform ?? "UNKNOWN",
    views: row._sum.viewsCount ?? 0,
    posts: row._count._all,
  }));

  return NextResponse.json(
    {
      kpis: {
        totalViews: kpiRow._sum.viewsCount ?? 0,
        totalLikes: kpiRow._sum.likesCount ?? 0,
        totalComments: kpiRow._sum.commentsCount ?? 0,
        avgEngagementRate: parseFloat((engagementRow._avg.engagementRate ?? 0).toFixed(2)),
        totalPosts: kpiRow._count._all,
        engagementSample: engagementRow._count._all,
      },
      monthlyTrend,
      leaderboard,
      platformBreakdown,
      campaigns: orgCampaigns,
      // The posting-time heatmap wants a median per weekday-hour bucket in the
      // viewer's zone. Reading every post row to get it is the exact cost this
      // route was rewritten to remove, and there is a test here pinning that, so
      // the field stays empty until it can be produced as an aggregate:
      // percentile_cont over EXTRACT(dow/hour FROM "postedAt" AT TIME ZONE $tz)
      // is 168 rows per platform and handles half-hour offsets correctly.
      postingTimes: [],
    },
    { headers: READ_CACHE_HEADERS }
  );
}
