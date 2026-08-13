import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { computeEngagementRate } from "@/lib/metrics";
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
            select: {
              id: true, phaseId: true, platform: true, postUrl: true, postedAt: true,
              viewsCount: true, likesCount: true, commentsCount: true, sharesCount: true,
              savesCount: true, engagementRate: true, status: true, lastSyncedAt: true,
              creator: { select: { name: true, handle: true } },
            },
          },
        },
      },
    },
  });

  if (!song) notFound();

  const allPosts = song.campaigns.flatMap((c) =>
    c.posts.map((p) => ({ ...p, campaignId: c.id, campaignTitle: c.title })),
  );
  const sum = (fn: (p: (typeof allPosts)[number]) => number) => allPosts.reduce((s, p) => s + fn(p), 0);
  const totalViews = sum((p) => p.viewsCount);
  const totalLikes = sum((p) => p.likesCount);
  const totalComments = sum((p) => p.commentsCount);
  const totalShares = sum((p) => p.sharesCount);

  const byPlatform = new Map<string, { views: number; posts: number }>();
  for (const p of allPosts) {
    const row = byPlatform.get(p.platform) ?? { views: 0, posts: 0 };
    row.views += p.viewsCount;
    row.posts += 1;
    byPlatform.set(p.platform, row);
  }

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
        views: phasePosts.reduce((s, p) => s + p.viewsCount, 0),
      };
    }),
  );

  return (
    <SongDashboard
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
          totalViews,
          totalLikes,
          totalComments,
          totalShares,
          totalBudget: song.campaigns.reduce((s, c) => s + (c.budget ?? 0), 0),
          engagementRate:
            computeEngagementRate({
              views: totalViews,
              likes: totalLikes,
              comments: totalComments,
              shares: totalShares,
              saves: sum((p) => p.savesCount),
            }) ?? 0,
        },
        campaigns: song.campaigns.map((c) => ({
          id: c.id,
          title: c.title,
          status: c.status,
          budget: c.budget,
          phaseCount: c.phases.length,
          postCount: c.posts.length,
          views: c.posts.reduce((s, p) => s + p.viewsCount, 0),
        })),
        phases,
        platformBreakdown: [...byPlatform.entries()]
          .map(([platform, row]) => ({ platform, ...row }))
          .sort((a, b) => b.views - a.views),
        posts: allPosts.map((p) => ({
          id: p.id,
          campaignId: p.campaignId,
          campaignTitle: p.campaignTitle,
          phaseId: p.phaseId,
          platform: p.platform,
          postUrl: p.postUrl,
          postedAt: p.postedAt.toISOString(),
          viewsCount: p.viewsCount,
          likesCount: p.likesCount,
          commentsCount: p.commentsCount,
          sharesCount: p.sharesCount,
          engagementRate: p.engagementRate,
          status: p.status,
          lastSyncedAt: p.lastSyncedAt ? p.lastSyncedAt.toISOString() : null,
          creatorName: p.creator?.name ?? null,
          creatorHandle: p.creator?.handle ?? null,
        })),
      }}
    />
  );
}
