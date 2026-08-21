import { db } from "@/lib/db";
import {
  computeCampaignEmv,
  computeEngagementRate,
  sumEngagements,
} from "@/lib/metrics";
import { metricValue } from "@/lib/metricDisplay";
import type { SharePlatform } from "@/lib/reports/shareVisibility";

type SeriesPlatform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE";
const SERIES_PLATFORMS: SeriesPlatform[] = ["TIKTOK", "INSTAGRAM", "YOUTUBE"];

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type CampaignPerformance = {
  currency: string;
  kpis: {
    views: number;
    /** null when no post in the campaign has had its engagement fetched. */
    engagements: number | null;
    engagementRate: number | null;
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
    engagements: number | null;
    engagementRate: number | null;
    emv: number;
  }[];
};

/**
 * What a public share link is allowed to carry.
 *
 * Distinct from CampaignPerformance because hiding a field in the component is
 * not hiding it at all: a client component's props are serialized into the RSC
 * payload, so a leaderboard that renders conditionally still ships every
 * creator's name to anyone who reads the HTML. The money fields become nullable
 * so a withheld value is absent rather than zero — a zero here would be
 * indistinguishable from a campaign that genuinely earned nothing.
 */
export type SharedReportData = Omit<CampaignPerformance, "kpis" | "leaderboard"> & {
  kpis: Omit<CampaignPerformance["kpis"], "emv"> & { emv: number | null };
  leaderboard: (Omit<CampaignPerformance["leaderboard"][number], "emv"> & { emv: number | null })[];
};

/**
 * Strips everything the link may not show, on the server, before the data can
 * reach a payload. Platform filtering is not done here — it happens in the
 * query, because the KPI totals have to be computed over the filtered set
 * rather than trimmed after the fact.
 */
export function redactForShare(
  data: CampaignPerformance,
  visibility: { showCreators: boolean; showEmv: boolean }
): SharedReportData {
  return {
    ...data,
    kpis: { ...data.kpis, emv: visibility.showEmv ? data.kpis.emv : null },
    leaderboard: visibility.showCreators
      ? data.leaderboard.map((row) => ({ ...row, emv: visibility.showEmv ? row.emv : null }))
      : [],
  };
}

export async function computeCampaignPerformance(
  campaign: { id: string; orgId: string; budget: number | null; currency: string },
  /**
   * Restricts every number in the report to these platforms. Applied in the
   * query rather than to the result, because the KPI totals, the leaderboard and
   * the platform split all derive from this one read — filtering afterwards
   * would leave the KPIs describing a wider set than the charts below them.
   * Empty or omitted means no restriction.
   */
  platforms?: readonly SharePlatform[]
): Promise<CampaignPerformance> {
  const posts = await db.post.findMany({
    where: {
      campaignId: campaign.id,
      ...(platforms?.length && { platform: { in: platforms as unknown as never } }),
    },
    select: {
      id: true,
      platform: true,
      postedAt: true,
      viewsCount: true,
      likesCount: true,
      commentsCount: true,
      sharesCount: true,
      savesCount: true,
      lastSyncedAt: true,
      creator: { select: { id: true, name: true, avatarUrl: true } },
    },
  });

  const snapshots =
    posts.length > 0
      ? await db.postMetricSnapshot.findMany({
          where: { postId: { in: posts.map((p) => p.id) } },
          select: { postId: true, viewsCount: true, recordedAt: true },
          orderBy: { recordedAt: "asc" },
        })
      : [];

  const views = posts.reduce((s, p) => s + (p.viewsCount ?? 0), 0);

  /* Engagement counters default to 0 for posts we never fetched, so summing them
     all would report a measured zero for an imported campaign. Only posts whose
     engagement is actually known contribute, and a campaign with none reports
     null rather than 0. */
  const measured = posts.filter(
    (p) => metricValue(p.likesCount, p.lastSyncedAt) !== null
  );
  const engagements =
    measured.length === 0
      ? null
      : measured.reduce(
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

  const measuredViews = measured.reduce((s, p) => s + (p.viewsCount ?? 0), 0);
  const engagementRate =
    engagements !== null && measuredViews > 0
      ? computeEngagementRate({ views: measuredViews, likes: engagements })
      : null;
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

  const kpis = { views, engagements, engagementRate, emv };

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
      engagements: number | null;
      measuredViews: number;
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
        engagements: null as number | null,
        measuredViews: 0,
      };
    entry.posts += 1;
    entry.views += p.viewsCount ?? 0;
    if (metricValue(p.likesCount, p.lastSyncedAt) !== null) {
      entry.engagements =
        (entry.engagements ?? 0) +
        sumEngagements({
          likes: p.likesCount,
          comments: p.commentsCount,
          shares: p.sharesCount,
          saves: p.savesCount,
        });
      entry.measuredViews += p.viewsCount ?? 0;
    }
    leaderboardMap.set(key, entry);
  }
  const leaderboard = Array.from(leaderboardMap.values())
    .map(({ measuredViews, ...c }) => ({
      ...c,
      engagementRate:
        c.engagements !== null && measuredViews > 0
          ? computeEngagementRate({ views: measuredViews, likes: c.engagements })
          : null,
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
    kpis,
    timeSeries,
    platformSplit,
    leaderboard,
  };
}
