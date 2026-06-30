import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { fetchPostMetrics } from "@/lib/platforms/fetchPostMetrics";

// POST /api/campaigns/[id]/posts/[postId]/sync — Trigger manual sync for a post
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; postId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const { id: campaignId, postId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const post = await db.post.findFirst({ where: { id: postId, campaignId } });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const metrics = await fetchPostMetrics(post.postUrl);
    if (!metrics) {
      return NextResponse.json({ error: "Could not fetch metrics for this post URL" }, { status: 422 });
    }

    const views = metrics.viewsCount;
    const likes = metrics.likesCount;
    const comments = metrics.commentsCount;
    const engagementRate = views > 0 ? ((likes + comments) / views) * 100 : 0;

    const [updated] = await db.$transaction([
      db.post.update({
        where: { id: postId },
        data: {
          viewsCount: views,
          likesCount: likes,
          commentsCount: comments,
          engagementRate,
          thumbnailUrl: metrics.thumbnailUrl ?? post.thumbnailUrl,
          caption: metrics.caption ?? post.caption,
          lastSyncedAt: new Date(),
        },
        include: {
          creator: { select: { id: true, name: true, handle: true, avatarUrl: true } },
          snapshots: { orderBy: { recordedAt: "desc" }, take: 50 },
        },
      }),
      db.postMetricSnapshot.create({
        data: {
          postId,
          viewsCount: views,
          likesCount: likes,
          commentsCount: comments,
          sharesCount: 0,
          engagementRate,
          syncSource: "api",
        },
      }),
    ]);

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to sync post:", error);
    return NextResponse.json({ error: "Failed to sync post" }, { status: 500 });
  }
}
