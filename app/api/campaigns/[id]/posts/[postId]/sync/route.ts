import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { fetchPostMetrics, hasMetricCounts } from "@/lib/platforms/fetchPostMetrics";

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

    const postData: Record<string, unknown> = {
      thumbnailUrl: metrics.thumbnailUrl ?? post.thumbnailUrl,
      caption: metrics.caption ?? post.caption,
      lastSyncedAt: new Date(),
    };
    const include = {
      creator: { select: { id: true, name: true, handle: true, avatarUrl: true } },
      snapshots: { orderBy: { recordedAt: "desc" as const }, take: 50 },
    };

    if (!hasMetricCounts(metrics)) {
      const updated = await db.post.update({ where: { id: postId }, data: postData, include });
      return NextResponse.json(updated);
    }

    const views = metrics.viewsCount ?? 0;
    const likes = metrics.likesCount ?? 0;
    const comments = metrics.commentsCount ?? 0;
    const shares = metrics.sharesCount ?? 0;
    const engagementRate =
      metrics.engagementRate ?? (views > 0 ? ((likes + comments) / views) * 100 : 0);
    postData.viewsCount = views;
    postData.likesCount = likes;
    postData.commentsCount = comments;
    postData.sharesCount = shares;
    postData.engagementRate = engagementRate;

    const [updated] = await db.$transaction([
      db.post.update({ where: { id: postId }, data: postData, include }),
      db.postMetricSnapshot.create({
        data: {
          postId,
          viewsCount: views,
          likesCount: likes,
          commentsCount: comments,
          sharesCount: shares,
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
