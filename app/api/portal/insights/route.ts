import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { fetchTikTokVideos } from "@/lib/platforms/tiktokDisplay";
import { ensureFreshTikTokToken } from "@/lib/platforms/tiktokToken";

export const dynamic = "force-dynamic";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

// GET /api/portal/insights — the creator's own numbers, read from their connected account.
export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const bare = session.handle.replace(/^@/, "");
    const creators = await db.creator.findMany({
      where: { deletedAt: null, OR: [{ handle: bare }, { handle: `@${bare}` }] },
      select: { id: true, orgId: true },
    });
    if (creators.length === 0) return NextResponse.json({ connected: false, posts: [] });

    const account = await db.creatorSocialAccount.findFirst({
      where: { creatorId: { in: creators.map((c) => c.id) }, platform: "TIKTOK" },
      select: {
        id: true,
        creatorId: true,
        handle: true,
        accessToken: true,
        refreshToken: true,
        tokenExpiry: true,
        followersCount: true,
      },
      orderBy: { createdAt: "asc" },
    });
    if (!account) return NextResponse.json({ connected: false, posts: [] });

    const orgId = creators.find((c) => c.id === account.creatorId)?.orgId;
    if (!orgId) return NextResponse.json({ connected: false, posts: [] });

    const token = await ensureFreshTikTokToken(account, orgId);
    if (!token)
      return NextResponse.json({
        connected: true,
        needsReconnect: true,
        handle: account.handle,
        posts: [],
      });

    const videos = await fetchTikTokVideos(token);
    if (videos === null)
      return NextResponse.json({
        connected: true,
        needsReconnect: true,
        handle: account.handle,
        posts: [],
      });

    const views = videos.map((v) => v.viewsCount);
    const totalViews = views.reduce((a, b) => a + b, 0);
    const best = videos.reduce<(typeof videos)[number] | null>(
      (top, v) => (!top || v.viewsCount > top.viewsCount ? v : top),
      null,
    );

    return NextResponse.json({
      connected: true,
      needsReconnect: false,
      handle: account.handle,
      followers: account.followersCount,
      sampleSize: videos.length,
      totalViews,
      medianViews: Math.round(median(views)),
      bestPost: best
        ? {
            id: best.id,
            caption: best.description || best.title || null,
            views: best.viewsCount,
            likes: best.likesCount,
            shareUrl: best.shareUrl,
          }
        : null,
      posts: videos.slice(0, 6).map((v) => ({
        id: v.id,
        caption: v.description || v.title || null,
        views: v.viewsCount,
        likes: v.likesCount,
        comments: v.commentsCount,
        shares: v.sharesCount,
        postedAt: v.postedAt,
        shareUrl: v.shareUrl,
      })),
    });
  } catch (error) {
    console.error("Failed to build creator insights:", error);
    return NextResponse.json({ error: "Failed to load insights" }, { status: 500 });
  }
}
