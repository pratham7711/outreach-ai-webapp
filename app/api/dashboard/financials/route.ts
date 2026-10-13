import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { READ_CACHE_HEADERS } from "@/lib/http/readCache";
import { cachedOrgRead, utcHourKey } from "@/lib/reports/orgReadCache";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { dateParam, parseQuery } from "@/lib/http/queryParams";
import { RATED_POSTS_FILTER, VIEWS_KNOWN_FILTER, postEngagementPercent, rollupEngagementFromTotals } from "@/lib/metricDisplay";
import { UNATTRIBUTED_CREATOR_WHERE } from "@/lib/posts/unattributedName";
import { duplicatePostIds, excludingDuplicates } from "@/lib/posts/duplicates";

const performanceQuerySchema = z.object({
  from: dateParam.optional(),
  to: dateParam.optional(),
  granularity: z.enum(["daily", "weekly", "monthly"]).default("monthly"),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * A bucket key. UTC throughout, and that is load-bearing: these dates come from
 * SQL date_trunc, which runs in the database's zone (UTC on Neon), so reading
 * them with local accessors shifts the key by one period wherever the offset is
 * negative. A 2026-08-01T00:00:00Z bucket read at UTC-11 is local month 7, so
 * every US-based developer saw the wrong month on the dashboard — all day, not
 * in a window, because the offset never changes sign.
 *
 * The weekly branch was the subtler half: it fed LOCAL calendar parts into a
 * Date.UTC() constructor, which silently relabels the day and can cross an ISO
 * week boundary.
 */
function getDateKey(date: Date, granularity: string): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  if (granularity === "daily") return `${y}-${m}-${d}`;
  if (granularity === "weekly") {
    // ISO week number
    const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
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
    // UTC, to match the bucket keys the rollup is grouped by.
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);

    const parsedQuery = parseQuery(performanceQuerySchema, searchParams);
    if (!parsedQuery.ok) return parsedQuery.response;
    const from = parsedQuery.data.from ?? sixMonthsAgo;
    const to = parsedQuery.data.to ?? now;
    const granularity = parsedQuery.data.granularity;

    /* Served from the org's data fingerprint (lib/reports/orgReadCache): the
       same figures are recomputed only once a post, campaign, creator,
       activation or daily views reading in the org has changed. A defaulted
       window slides with the clock, so it is keyed by the UTC hour instead of
       its exact bounds -- otherwise no two requests would ever share a key. */
    const body = await cachedOrgRead(
      "dashboard-performance",
      orgId,
      [
        parsedQuery.data.from?.toISOString() ?? `six-months@${utcHourKey(now)}`,
        parsedQuery.data.to?.toISOString() ?? `now@${utcHourKey(now)}`,
        granularity,
      ],
      { activations: true, viewsSnapshots: true },
      () => performanceBody(orgId, from, to, granularity),
    );
    return NextResponse.json(body, { headers: READ_CACHE_HEADERS });
  } catch (error) {
    console.error("Dashboard performance error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function performanceBody(orgId: string, from: Date, to: Date, granularity: "daily" | "weekly" | "monthly") {
  // Everything below aggregates in the database. This used to load every post
  // in the range, every campaign and every activation into Node and reduce
  // over them in JavaScript: 4.5 seconds of work to produce 4 KB of JSON.

  /* The date range means "what happened in this period", so it reads the day
     the creator posted, not the day we imported the row. Filtering on
     createdAt made a six-month view depend on our own import history. */
  /* deletedAt: null, the same filter activeCampaigns and campaignTitles carry.
     Without it the Total Views and Total Posts tiles counted posts belonging to
     soft-deleted campaigns, and "Views by campaign" drew a bar for a campaign
     the title lookup deliberately omits -- which rendered as "Unknown campaign".
     Two tiles and a chart on one screen disagreeing about which campaigns exist. */
  const postWhere = {
    campaign: { orgId, deletedAt: null },
    ...NOT_REMOVED,
    postedAt: { gte: from, lte: to },
  };
  /* The org-wide breakdowns count a video once however many campaigns it was
     delivered against (lib/posts/duplicates); views by campaign keeps every
     copy, because each campaign counts its own. */
  const orgPostWhere = { ...postWhere, ...excludingDuplicates(await duplicatePostIds(orgId)) };
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
    viewsKnown,
  ] = await Promise.all([
    db.campaign.count({ where: { orgId, deletedAt: null, status: "IN_PROGRESS" } }),
    /* The creators who posted in the selected range. This was every creator
       holding an activation anywhere -- a number the range picker above it
       could not move, so the tile read 6 on 7D, 30D and 1Y alike beside Total
       Views and Total Posts that did move. The campaign's soft delete still
       applies (postWhere), and the org's Unattributed holding row is a filing
       label, not a creator, so it is not counted. */
    db.post.groupBy({
      by: ["creatorId"],
      where: { ...orgPostWhere, creator: { NOT: UNATTRIBUTED_CREATOR_WHERE } },
    }),
    /* Measured, not derived. One row per day, written by
       /api/cron/snapshot-org-views at 00:30 UTC (vercel.json).

       This used to be computed here: posts bucketed by publication date, each
       contributing its CURRENT view count, accumulated. That has a property
       no client report should have -- the past moves. A March post gaining
       views today raised March and every point after it, so the chart
       screenshotted last week no longer matched the chart today. It also
       could not answer the question its own axis implies, because nothing in
       the database recorded what the total actually was on any given day.

       A reading is a LEVEL (lifetime views of every post the org holds, as of
       that morning), so bucketing to weekly or monthly takes the LAST row in
       the bucket. Summing would count the same lifetime views once per day
       and produce a number that means nothing. DISTINCT ON is Postgres's way
       of saying "one row per bucket, the first one in this ordering".

       truncUnit comes from a validated enum, never from user text. */
    db.$queryRawUnsafe<{ bucket: Date; views: number; posts: number }[]>(
      `SELECT DISTINCT ON (bucket)
              date_trunc('${truncUnit}', s."day") AS bucket,
              s."viewsCount" AS views,
              s."postsCount" AS posts
         FROM "OrgViewsSnapshot" s
        WHERE s."orgId" = $1 AND s."day" >= $2 AND s."day" <= $3
        ORDER BY bucket, s."day" DESC`,
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
      where: orgPostWhere,
      _sum: { viewsCount: true },
      _count: { _all: true },
    }),
    /* Not the Unattributed holding row: it is not a creator, and the
       campaign leaderboards already leave it out. */
    db.post.groupBy({
      by: ["creatorId"],
      where: { ...orgPostWhere, creator: { NOT: UNATTRIBUTED_CREATOR_WHERE } },
      _sum: { viewsCount: true },
      _count: { _all: true },
      orderBy: { _sum: { viewsCount: "desc" } },
      take: 10,
    }),
    db.campaign.findMany({
      where: { orgId, deletedAt: null },
      select: { id: true, title: true },
    }),
    /* Top posts are posts with a view count. Ordered by views alone, a range
       of mostly Instagram photos (which publish none) filled the table with
       0-view rows ranked as "top". */
    db.post.findMany({
      where: { ...orgPostWhere, ...VIEWS_KNOWN_FILTER },
      orderBy: { viewsCount: "desc" },
      take: 5,
      select: {
        id: true, postUrl: true, platform: true, viewsCount: true,
        likesCount: true, commentsCount: true, sharesCount: true, savesCount: true,
        lastSyncedAt: true, platformMetrics: true,
        creator: { select: { id: true, name: true, handle: true } },
        campaign: { select: { title: true } },
      },
    }),
    /* What the Total Views tile can stand behind: how many posts in range have
       a view count, and the newest reading among them. */
    db.post.aggregate({
      where: { ...orgPostWhere, ...VIEWS_KNOWN_FILTER },
      _count: { _all: true },
      _max: { lastSyncedAt: true, lastFreshAt: true },
    }),
  ]);

  const newest = [viewsKnown?._max?.lastSyncedAt, viewsKnown?._max?.lastFreshAt]
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const summary = {
    activeCampaigns,
    totalCreators: distinctCreators.length,
    /* Posts in range with a view count, for "views known for N of M posts";
       Total Views is a dash when this is 0, not the sum of unread zeroes. */
    viewsKnownPosts: viewsKnown?._count?._all ?? null,
    /* The newest reading behind Total Views: our read or the import's. */
    asOf: newest ? newest.toISOString() : null,
  };

  const viewsOverTime = bucketRows.map((r) => ({
    date: getDateKey(new Date(r.bucket), granularity),
    views: Number(r.views),
    posts: Number(r.posts),
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
        /* platform is not decoration. One person's TikTok and Instagram
           accounts are two Creator rows with the SAME handle -- there is no
           unique constraint on (orgId, handle) and there should not be -- so
           a table showing only "@handle" lists them twice and reads as a
           duplicated record. It fooled me during a review of this very
           page. */
        select: {
          id: true, name: true, handle: true, platform: true,
          _count: { select: { activations: true } },
        },
      })
    : [];
  const creatorById = new Map(creatorRows.map((c) => [c.id, c]));

  /* The campaign rate, per creator: engagements over views across their
     measured posts. Not an average of Post.engagementRate -- that column holds
     CreatorCore's fraction on imported rows and a percent on synced ones, and
     a 0 on every post nobody read, so its mean printed 0.0% for most creators. */
  const measuredByCreator = creatorIds.length
    ? await db.post.groupBy({
        by: ["creatorId"],
        where: { AND: [orgPostWhere, { creatorId: { in: creatorIds } }, RATED_POSTS_FILTER] },
        _sum: { viewsCount: true, likesCount: true, commentsCount: true, sharesCount: true, savesCount: true },
        _count: { _all: true },
      })
    : [];
  const engagementByCreator = new Map(
    measuredByCreator.map((m) => {
      const { rate } = rollupEngagementFromTotals({ measuredPosts: m._count._all, ...m._sum });
      return [m.creatorId, rate === null ? null : Math.round(rate * 10000) / 100];
    })
  );

  const creatorPerformance = byCreator.map((c) => {
    const creator = creatorById.get(c.creatorId);
    return {
      creatorId: c.creatorId,
      name: creator?.name ?? "Unknown",
      handle: creator?.handle ?? "",
      platform: creator?.platform ?? null,
      activationCount: creator?._count.activations ?? 0,
      /* Null, not 0, when none of their posts in range has a view count -- the
         sum of unread zeroes (VIEWS_KNOWN_FILTER's test: a positive sum means
         some post had views). Ordered by views, so they already sit last. */
      views: (c._sum.viewsCount ?? 0) > 0 ? c._sum.viewsCount : null,
      avgEngagement: engagementByCreator.get(c.creatorId) ?? null,
    };
  });

  const topPosts = topPostRows.map((p) => ({
    id: p.id,
    postUrl: p.postUrl,
    platform: p.platform,
    viewsCount: p.viewsCount,
    likesCount: p.likesCount,
    engagementRate: postEngagementPercent(p),
    creatorId: p.creator?.id ?? null,
    creatorName: p.creator?.name ?? null,
    creatorHandle: p.creator?.handle ?? null,
    campaignTitle: p.campaign?.title ?? null,
  }));

  return {
    summary,
    viewsOverTime,
    viewsByCampaign,
    platformBreakdown,
    creatorPerformance,
    topPosts,
  };
}
