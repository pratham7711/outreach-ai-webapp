import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { oneCopyPerVideo } from "@/lib/posts/duplicates";
import { authenticateRequest } from "@/lib/authenticate";
import { requirePermission } from "@/lib/authz";

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  artist: z.string().trim().min(1).max(200),
  isrc: z.string().trim().max(32).optional().nullable(),
  releaseDate: z.string().datetime().optional().nullable(),
  coverUrl: z.string().url().max(2048).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const songs = await db.song.findMany({
    where: { orgId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      artist: true,
      coverUrl: true,
      releaseDate: true,
      createdAt: true,
      campaigns: {
        where: { deletedAt: null },
        select: {
          id: true,
          status: true,
          posts: { select: { viewsCount: true, platform: true, postUrl: true } },
        },
      },
    },
  });

  return NextResponse.json({
    songs: songs.map((s) => {
      const posts = s.campaigns.flatMap((c) => c.posts);
      return {
        id: s.id,
        title: s.title,
        artist: s.artist,
        coverUrl: s.coverUrl,
        releaseDate: s.releaseDate,
        campaignCount: s.campaigns.length,
        activeCampaignCount: s.campaigns.filter((c) => c.status === "IN_PROGRESS").length,
        postCount: posts.length,
        // Each video once, as on the song's own page (lib/posts/duplicates).
        totalViews: oneCopyPerVideo(posts).reduce((sum, p) => sum + p.viewsCount, 0),
        platforms: [...new Set(posts.map((p) => p.platform))],
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  /* Songs and sound trackers are what campaigns point at, and campaign creation
     makes them (ensureSongForAudio), so they take the permission that creates a
     campaign -- as clients and folders already do. */
  const gate = await requirePermission(req, "campaigns:create");
  if (!gate.ok) return gate.response;
  const result = gate.auth;
  const { orgId } = result;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", issues: parsed.error.issues }, { status: 400 });
  }
  const { releaseDate, ...rest } = parsed.data;

  const song = await db.song.create({
    // orgId comes from the session, never the body — a caller must not be able
    // to plant a song in someone else's org.
    data: {
      ...rest,
      orgId,
      releaseDate: releaseDate ? new Date(releaseDate) : null,
    },
    select: { id: true, title: true, artist: true },
  });

  return NextResponse.json({ song }, { status: 201 });
}
