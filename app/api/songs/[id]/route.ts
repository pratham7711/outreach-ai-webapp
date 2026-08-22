import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { computeEngagementRate } from "@/lib/metrics";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

/**
 * Everything the song dashboard renders, in one round trip.
 *
 * A song is the roll-up of every campaign promoting it, so each figure here is
 * an aggregate over campaigns → phases → posts. The per-campaign, per-phase and
 * per-platform breakdowns all carry their own ids so every number on the
 * dashboard can link through to exactly the rows it counted.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { id } = await ctx.params;

  const song = await db.song.findFirst({
    // orgId in the filter, not just the id — otherwise any signed-in user could
    // read another org's song by guessing a cuid.
    where: { id, orgId, deletedAt: null },
    select: {
      id: true,
      title: true,
      artist: true,
      isrc: true,
      coverUrl: true,
      releaseDate: true,
      notes: true,
      campaigns: {
        where: { deletedAt: null },
        select: {
          id: true,
          title: true,
          status: true,
          budget: true,
          phases: {
            select: { id: true, name: true, sequence: true, targetPosts: true },
            orderBy: { sequence: "asc" },
          },
          posts: {
            select: {
              id: true,
              phaseId: true,
              platform: true,
              postUrl: true,
              thumbnailUrl: true,
              caption: true,
              postedAt: true,
              viewsCount: true,
              likesCount: true,
              commentsCount: true,
              sharesCount: true,
              savesCount: true,
              engagementRate: true,
              status: true,
              lastSyncedAt: true,
              creator: { select: { id: true, name: true, handle: true, avatarUrl: true } },
            },
          },
        },
      },
    },
  });

  if (!song) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const campaignRows = song.campaigns;
  const allPosts = campaignRows.flatMap((c) =>
    c.posts.map((p) => ({ ...p, campaignId: c.id, campaignTitle: c.title })),
  );

  const sum = (fn: (p: (typeof allPosts)[number]) => number) => allPosts.reduce((s, p) => s + fn(p), 0);
  const totalViews = sum((p) => p.viewsCount);
  const totalLikes = sum((p) => p.likesCount);
  const totalComments = sum((p) => p.commentsCount);
  const totalShares = sum((p) => p.sharesCount);
  const totalSaves = sum((p) => p.savesCount);

  const byPlatform = new Map<string, { views: number; posts: number }>();
  for (const p of allPosts) {
    const row = byPlatform.get(p.platform) ?? { views: 0, posts: 0 };
    row.views += p.viewsCount;
    row.posts += 1;
    byPlatform.set(p.platform, row);
  }

  const phases = campaignRows.flatMap((c) =>
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

  return NextResponse.json({
    song: {
      id: song.id,
      title: song.title,
      artist: song.artist,
      isrc: song.isrc,
      coverUrl: song.coverUrl,
      releaseDate: song.releaseDate,
      notes: song.notes,
    },
    summary: {
      campaignCount: campaignRows.length,
      activeCampaignCount: campaignRows.filter((c) => c.status === "IN_PROGRESS").length,
      phaseCount: phases.length,
      postCount: allPosts.length,
      totalViews,
      totalLikes,
      totalComments,
      totalShares,
      totalSaves,
      totalBudget: campaignRows.reduce((s, c) => s + (c.budget ?? 0), 0),
      engagementRate:
        computeEngagementRate({
          views: totalViews,
          likes: totalLikes,
          comments: totalComments,
          shares: totalShares,
          saves: totalSaves,
        }) ?? 0,
    },
    campaigns: campaignRows.map((c) => ({
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
      thumbnailUrl: p.thumbnailUrl,
      caption: p.caption,
      postedAt: p.postedAt,
      viewsCount: p.viewsCount,
      likesCount: p.likesCount,
      commentsCount: p.commentsCount,
      sharesCount: p.sharesCount,
      engagementRate: p.engagementRate,
      status: p.status,
      lastSyncedAt: p.lastSyncedAt,
      creatorName: p.creator?.name ?? null,
      creatorHandle: p.creator?.handle ?? null,
    })),
  });
}


const updateSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  artist: z.string().trim().min(1).max(200).optional(),
  isrc: z.string().trim().max(32).optional().nullable(),
  releaseDate: z.string().datetime().optional().nullable(),
  coverUrl: z.string().url().max(2048).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
  /** A tracked TikTok sound to attach, or null to detach. */
  soundId: z.string().min(1).optional().nullable(),
});

/**
 * Edit a song, including which tracked TikTok sound it is promoted with.
 *
 * The sound is looked up under the caller's own org before it is written. A
 * plain FK write would accept any cuid the client sent, which would let one
 * tenant point its song at another tenant's tracker and pull that tracker's
 * usage curve into its own campaign report.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId, userId, actorEmail } = result;
  const { id } = await ctx.params;

  const parsed = updateSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await db.song.findFirst({ where: { id, orgId, deletedAt: null }, select: { id: true } });
  if (!existing) return NextResponse.json({ error: "Song not found" }, { status: 404 });

  const { soundId, releaseDate, ...rest } = parsed.data;

  if (soundId) {
    const sound = await db.tikTokSound.findFirst({ where: { id: soundId, orgId }, select: { id: true } });
    if (!sound) return NextResponse.json({ error: "Tracked sound not found" }, { status: 404 });
  }

  const song = await db.song.update({
    where: { id },
    data: {
      ...rest,
      ...(soundId !== undefined && { soundId }),
      ...(releaseDate !== undefined && { releaseDate: releaseDate ? new Date(releaseDate) : null }),
    },
    select: { id: true, title: true, artist: true, coverUrl: true, soundId: true },
  });

  await logAudit({
    orgId,
    userId: userId ?? undefined,
    actorEmail: actorEmail ?? undefined,
    action: "song.update",
    entityType: "song",
    entityId: song.id,
    entityLabel: song.title,
    ipAddress: getRequestIp(req),
    metadata: { fields: Object.keys(parsed.data) },
  });

  return NextResponse.json({ song });
}
