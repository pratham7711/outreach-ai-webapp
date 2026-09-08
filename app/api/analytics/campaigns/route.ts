import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { READ_CACHE_HEADERS } from "@/lib/http/readCache";
import { authenticateRequest } from "@/lib/authenticate";
import { carryForwardViewsByDay } from "@/lib/analytics/viewsSeries";
import {
  computeCampaignEmv,
  computeEngagementRate,
  sumEngagements,
  campaignVsOrgAverage,
} from "@/lib/metrics";

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

  const idsRaw = req.nextUrl.searchParams.get("ids") ?? "";
  const requestedIds = idsRaw.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5);
  if (requestedIds.length === 0) {
    return NextResponse.json({ campaigns: [], series: [], orgAverages: null });
  }

  const from = parseFrom(req);
  const platform = parsePlatform(req);

  const ownedCampaigns = await db.campaign.findMany({
    where: { id: { in: requestedIds }, orgId, deletedAt: null },
    select: { id: true, title: true },
  });
  const campaignIds = ownedCampaigns.map((c) => c.id);
  if (campaignIds.length === 0) {
    return NextResponse.json({ campaigns: [], series: [], orgAverages: null });
  }

  const postWhere: any = { campaignId: { in: campaignIds } };
  if (platform) postWhere.platform = platform;
  if (from) postWhere.postedAt = { gte: from };

  const orgPostWhere: any = { campaign: { orgId, deletedAt: null } };
  if (platform) orgPostWhere.platform = platform;
  if (from) orgPostWhere.postedAt = { gte: from };

  const [posts, orgPosts] = await Promise.all([
    db.post.findMany({
      where: postWhere,
      select: {
        id: true,
        campaignId: true,
        platform: true,
        postedAt: true,
        viewsCount: true,
        likesCount: true,
        commentsCount: true,
        sharesCount: true,
        savesCount: true,
        snapshots: {
          where: from ? { recordedAt: { gte: from } } : undefined,
          select: { recordedAt: true, viewsCount: true },
          orderBy: { recordedAt: "asc" },
        },
      },
    }),
    db.post.findMany({
      where: orgPostWhere,
      select: {
        campaignId: true,
        platform: true,
        viewsCount: true,
        likesCount: true,
        commentsCount: true,
        sharesCount: true,
        savesCount: true,
      },
    }),
  ]);

  type CampAgg = {
    views: number;
    likes: number;
    comments: number;
    shares: number;
    saves: number;
    emvPosts: { platform: string; views: number; likes: number; comments: number; shares: number; saves: number }[];
  };
  const emptyAgg = (): CampAgg => ({ views: 0, likes: 0, comments: 0, shares: 0, saves: 0, emvPosts: [] });

  function pushPost(agg: CampAgg, p: { platform: string; viewsCount: number; likesCount: number; commentsCount: number; sharesCount: number; savesCount: number }) {
    agg.views += p.viewsCount;
    agg.likes += p.likesCount;
    agg.comments += p.commentsCount;
    agg.shares += p.sharesCount;
    agg.saves += p.savesCount;
    agg.emvPosts.push({
      platform: p.platform,
      views: p.viewsCount,
      likes: p.likesCount,
      comments: p.commentsCount,
      shares: p.sharesCount,
      saves: p.savesCount,
    });
  }

  const orgByCampaign: Record<string, CampAgg> = {};
  for (const p of orgPosts) {
    const a = orgByCampaign[p.campaignId] ?? (orgByCampaign[p.campaignId] = emptyAgg());
    pushPost(a, p);
  }
  const orgEmvValues = Object.values(orgByCampaign).map((a) => computeCampaignEmv(a.emvPosts));
  const orgViewValues = Object.values(orgByCampaign).map((a) => a.views);
  const orgEngRateValues = Object.values(orgByCampaign).map((a) =>
    computeEngagementRate({ views: a.views, likes: a.likes, comments: a.comments, shares: a.shares, saves: a.saves })
  );

  const selByCampaign: Record<string, CampAgg> = {};
  for (const id of campaignIds) {
    selByCampaign[id] = emptyAgg();
  }
  for (const p of posts) {
    pushPost(selByCampaign[p.campaignId], p);
  }

  const titleById = Object.fromEntries(ownedCampaigns.map((c) => [c.id, c.title]));

  const comparison = campaignIds.map((id) => {
    const a = selByCampaign[id];
    const engagements = sumEngagements({ likes: a.likes, comments: a.comments, shares: a.shares, saves: a.saves });
    const engRate = computeEngagementRate({
      views: a.views, likes: a.likes, comments: a.comments, shares: a.shares, saves: a.saves,
    });
    const emv = computeCampaignEmv(a.emvPosts);
    return {
      id,
      title: titleById[id] ?? "Untitled",
      views: a.views,
      engagements,
      engagementRate: engRate ?? 0,
      emv,
      viewsVsOrg: campaignVsOrgAverage({ campaignValue: a.views, orgValues: orgViewValues }),
      engRateVsOrg: campaignVsOrgAverage({ campaignValue: engRate, orgValues: orgEngRateValues }),
      emvVsOrg: campaignVsOrgAverage({ campaignValue: emv, orgValues: orgEmvValues }),
    };
  });

  /* PostMetricSnapshot.viewsCount is a post's lifetime total as of that reading,
     not that day's takings. This chart used to ADD every snapshot landing on a
     day, so an hourly-synced post counted its whole view count up to 24 times
     over and the comparison lines ran an order of magnitude above the campaigns'
     own KPI totals. carryForwardViewsByDay is the rule the campaign performance
     report already applied -- latest reading per post per day, carried forward
     until a newer one replaces it -- shared now so the two agree. */
  const series = carryForwardViewsByDay({
    posts: posts.map((p) => ({
      id: p.id,
      group: p.campaignId,
      postedAt: p.postedAt,
      viewsCount: p.viewsCount,
    })),
    snapshots: posts.flatMap((p) =>
      p.snapshots.map((s) => ({
        postId: p.id,
        recordedAt: s.recordedAt,
        viewsCount: s.viewsCount,
      }))
    ),
    groups: campaignIds,
  }).map(({ date, totals }) => ({ date, ...totals } as Record<string, number | string>));

  return NextResponse.json({
    campaigns: ownedCampaigns,
    comparison,
    series,
  }, { headers: READ_CACHE_HEADERS });
}
