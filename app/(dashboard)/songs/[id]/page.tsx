import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { fieldMetricValue, postEngagementPercent, rollupEngagement } from "@/lib/metricDisplay";
import { oneCopyPerVideo } from "@/lib/posts/duplicates";
import { viewTotals } from "@/lib/posts/viewTotals";
import SongDashboard from "./SongDashboard";

export default async function SongPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;
  const { id } = await params;

  const song = await db.song.findFirst({
    // orgId is part of the lookup, so another org's song is a 404 rather than a leak.
    where: { id, orgId, deletedAt: null },
    select: {
      id: true,
      title: true,
      artist: true,
      coverUrl: true,
      releaseDate: true,
      campaigns: {
        where: { deletedAt: null },
        select: {
          id: true,
          title: true,
          status: true,
          budget: true,
          phases: { select: { id: true, name: true, sequence: true, targetPosts: true }, orderBy: { sequence: "asc" } },
          posts: {
            where: NOT_REMOVED,
            select: {
              id: true, phaseId: true, platform: true, postUrl: true, postedAt: true,
              viewsCount: true, likesCount: true, commentsCount: true, sharesCount: true,
              savesCount: true, engagementRate: true, status: true, lastSyncedAt: true, lastFreshAt: true, platformMetrics: true,
              creator: { select: { id: true, name: true, handle: true } },
            },
          },
        },
      },
    },
  });

  if (!song) notFound();

  const orgCampaigns = await db.campaign.findMany({
    where: { orgId, deletedAt: null },
    select: { id: true, title: true, songId: true },
    orderBy: { createdAt: "desc" },
  });

  const allPosts = song.campaigns.flatMap((c) =>
    c.posts.map((p) => ({ ...p, campaignId: c.id, campaignTitle: c.title })),
  );
  /* Each video once, exactly as GET /api/songs/[id] counts the song's totals:
     this page summed every row, so a video delivered to two of the song's
     campaigns counted twice here and once in the API. */
  const songPosts = oneCopyPerVideo(allPosts);
  const sum = (fn: (p: (typeof allPosts)[number]) => number) => songPosts.reduce((s, p) => s + fn(p), 0);
  const totals = viewTotals(songPosts);
  const totalLikes = sum((p) => p.likesCount);
  const totalComments = sum((p) => p.commentsCount);
  const totalShares = sum((p) => p.sharesCount);

  /* Views per group count only the views a post has; a group none of whose
     posts was read is null, not 0 (an Instagram-photo platform row said "0"). */
  const byPlatform = new Map<string, (typeof allPosts)[number][]>();
  for (const p of songPosts) byPlatform.set(p.platform, [...(byPlatform.get(p.platform) ?? []), p]);

  const phases = song.campaigns.flatMap((c) =>
    c.phases.map((ph) => {
      const phasePosts = c.posts.filter((p) => p.phaseId === ph.id);
      return {
        id: ph.id,
        name: ph.name,
        sequence: ph.sequence,
        campaignId: c.id,
        campaignTitle: c.title,
        targetPosts: ph.targetPosts,
        postCount: phasePosts.length,
        views: viewTotals(phasePosts).views,
      };
    }),
  );

  return (
    <SongDashboard
      attachable={orgCampaigns}
      data={{
        song: {
          id: song.id,
          title: song.title,
          artist: song.artist,
          coverUrl: song.coverUrl,
          releaseDate: song.releaseDate ? song.releaseDate.toISOString() : null,
        },
        summary: {
          campaignCount: song.campaigns.length,
          activeCampaignCount: song.campaigns.filter((c) => c.status === "IN_PROGRESS").length,
          phaseCount: phases.length,
          postCount: allPosts.length,
          totalViews: totals.views,
          viewsKnown: totals.viewsKnown,
          videoCount: totals.posts,
          viewsAsOf: totals.asOf,
          totalLikes,
          totalComments,
          totalShares,
          totalBudget: song.campaigns.reduce((s, c) => s + (c.budget ?? 0), 0),
          /* The product's one rollup rule, and null rather than 0 when no post
             has both views and likes read. */
          engagementRate: rollupEngagement(songPosts).rate,
        },
        campaigns: song.campaigns.map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          budget: c.budget,
          phaseCount: c.phases.length,
          postCount: c.posts.length,
          views: viewTotals(c.posts).views,
        })),
        phases,
        platformBreakdown: [...byPlatform.entries()]
          .map(([platform, rows]) => ({ platform, views: viewTotals(rows).views, posts: rows.length }))
          .sort((a, b) => (b.views ?? -1) - (a.views ?? -1)),
        posts: allPosts.map((p) => ({
          id: p.id,
          campaignId: p.campaignId,
          campaignTitle: p.campaignTitle,
          phaseId: p.phaseId,
          platform: p.platform,
          postUrl: p.postUrl,
          postedAt: p.postedAt.toISOString(),
          viewsCount: p.viewsCount,
          viewsKnown: fieldMetricValue(p.viewsCount, p.lastSyncedAt, p.platformMetrics, "views") !== null,
          likesCount: p.likesCount,
          commentsCount: p.commentsCount,
          sharesCount: p.sharesCount,
          engagementRate: postEngagementPercent(p),
          status: p.status,
          lastSyncedAt: p.lastSyncedAt ? p.lastSyncedAt.toISOString() : null,
          creatorId: p.creator?.id ?? null,
          creatorName: p.creator?.name ?? null,
          creatorHandle: p.creator?.handle ?? null,
        })),
      }}
    />
  );
}
