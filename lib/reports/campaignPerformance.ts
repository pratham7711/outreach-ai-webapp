import { db } from "@/lib/db";
import {
  computeCampaignEmv,
  computeCpm,
  computeCpe,
  computeEngagementRate,
  sumEngagements,
} from "@/lib/metrics";

type SeriesPlatform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE";
const SERIES_PLATFORMS: SeriesPlatform[] = ["TIKTOK", "INSTAGRAM", "YOUTUBE"];

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type CampaignPerformance = {
  currency: string;
  spendSource: "PAID_PAYOUTS" | "BUDGET";
  kpis: {
    views: number;
    engagements: number;
    engagementRate: number | null;
    spend: number;
    cpm: number | null;
    cpe: number | null;
    emv: number;
  };
  timeSeries: { date: string; TIKTOK: number; INSTAGRAM: number; YOUTUBE: number }[];
  platformSplit: { platform: string; views: number; posts: number }[];
  leaderboard: {
    creatorId: string;
    name: string;
    avatarUrl: string | null;
    posts: number;
    views: number;
    engagements: number;
    engagementRate: number | null;
    emv: number;
  }[];
};

export async function computeCampaignPerformance(
  campaign: { id: string; orgId: string; budget: number | null; currency: string }
): Promise<CampaignPerformance> {
  const posts = await db.post.findMany({
    where: { campaignId: campaign.id },
    select: {
      id: true,
      platform: true,
      postedAt: true,
      viewsCount: true,
      likesCount: true,
      commentsCount: true,
      sharesCount: true,
      savesCount: true,
      creator: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  const [paidPayouts, snapshots] = await Promise.all([
    db.payout.aggregate({
      where: { campaignId: campaign.id, orgId: campaign.orgId, status: "SUCCESS" },
      _sum: { amount: true },
    }),
    posts.length > 0
      ? db.postMetricSnapshot.findMany({
          where: { postId: { in: posts.map((p) => p.id) } },
          select: { postId: true, viewsCount: true, recordedAt: true },
          orderBy: { recordedAt: "asc" },
        })
      : Promise.resolve([]),
  ]);

  const paidSpend = paidPayouts._sum.amount ?? 0;
  const spend = paidSpend > 0 ? paidSpend : campaign.budget ?? 0;

  const views = posts.reduce((s, p) => s + (p.viewsCount ?? 0), 0);
  const engagements = posts.reduce(
    (s, p) =>
      s +
      sumEngagements({
        likes: p.likesCount,
        comments: p.commentsCount,
        shares: p.sharesCount,
        saves: p.savesCount,
      }),
    0
  );

  const engagementRate =
    views > 0 ? computeEngagementRate({ views, likes: engagements }) : null;
  const cpm = computeCpm({ spend, views });
  const cpe = computeCpe({ spend, engagements });
  const emv = computeCampaignEmv(
    posts.map((p) => ({
      platform: p.platform,
      views: p.viewsCount,
      likes: p.likesCount,
      comments: p.commentsCount,
      shares: p.sharesCount,
      saves: p.savesCount,
    }))
  );

  const kpis = { views, engagements, engagementRate, spend, cpm, cpe, emv };

  const platformByPost = new Map(posts.map((p) => [p.id, p.platform]));
  const buckets = new Map<string, Record<SeriesPlatform, number>>();
  const emptyRow = (): Record<SeriesPlatform, number> => ({
    TIKTOK: 0,
    INSTAGRAM: 0,
    YOUTUBE: 0,
  });

  if (snapshots.length > 0) {
    const latestPerPostDay = new Map<string, number>();
    for (const snap of snapshots) {
      const platform = platformByPost.get(snap.postId);
      if (!platform || !SERIES_PLATFORMS.includes(platform as SeriesPlatform)) continue;
      const day = dateKey(snap.recordedAt);
      latestPerPostDay.set(`${snap.postId}|${day}`, snap.viewsCount ?? 0);
    }
    for (const [composite, viewsCount] of latestPerPostDay) {
      const [postId, day] = composite.split("|");
      const platform = platformByPost.get(postId) as SeriesPlatform;
      if (!buckets.has(day)) buckets.set(day, emptyRow());
      buckets.get(day)![platform] += viewsCount;
    }
  } else {
    for (const p of posts) {
      if (!SERIES_PLATFORMS.includes(p.platform as SeriesPlatform)) continue;
      const day = dateKey(p.postedAt);
      if (!buckets.has(day)) buckets.set(day, emptyRow());
      buckets.get(day)![p.platform as SeriesPlatform] += p.viewsCount ?? 0;
    }
  }

  const timeSeries = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => ({ date, ...row }));

  const platformSplitMap = new Map<string, { views: number; posts: number }>();
  for (const p of posts) {
    const entry = platformSplitMap.get(p.platform) ?? { views: 0, posts: 0 };
    entry.views += p.viewsCount ?? 0;
    entry.posts += 1;
    platformSplitMap.set(p.platform, entry);
  }
  const platformSplit = Array.from(platformSplitMap.entries())
    .map(([platform, v]) => ({ platform, views: v.views, posts: v.posts }))
    .sort((a, b) => b.views - a.views);

  const leaderboardMap = new Map<
    string,
    {
      creatorId: string;
      name: string;
      avatarUrl: string | null;
      posts: number;
      views: number;
      engagements: number;
    }
  >();
  for (const p of posts) {
    const key = p.creator.id;
    const entry =
      leaderboardMap.get(key) ??
      {
        creatorId: p.creator.id,
        name: p.creator.name,
        avatarUrl: p.creator.avatarUrl,
        posts: 0,
        views: 0,
        engagements: 0,
      };
    entry.posts += 1;
    entry.views += p.viewsCount ?? 0;
    entry.engagements += sumEngagements({
      likes: p.likesCount,
      comments: p.commentsCount,
      shares: p.sharesCount,
      saves: p.savesCount,
    });
    leaderboardMap.set(key, entry);
  }
  const leaderboard = Array.from(leaderboardMap.values())
    .map((c) => ({
      ...c,
      engagementRate:
        c.views > 0 ? computeEngagementRate({ views: c.views, likes: c.engagements }) : null,
      emv: computeCampaignEmv(
        posts
          .filter((p) => p.creator.id === c.creatorId)
          .map((p) => ({
            platform: p.platform,
            views: p.viewsCount,
            likes: p.likesCount,
            comments: p.commentsCount,
            shares: p.sharesCount,
            saves: p.savesCount,
          }))
      ),
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  return {
    currency: campaign.currency,
    spendSource: paidSpend > 0 ? "PAID_PAYOUTS" : "BUDGET",
    kpis,
    timeSeries,
    platformSplit,
    leaderboard,
  };
}
