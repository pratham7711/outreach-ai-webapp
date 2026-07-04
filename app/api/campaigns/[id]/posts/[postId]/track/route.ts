import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { fetchPostMetrics, hasMetricCounts } from "@/lib/platforms/fetchPostMetrics";
import { z } from "zod";

const trackSchema = z.object({ enabled: z.boolean() });

type RouteParams = { params: Promise<{ id: string; postId: string }> };

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = authResult;
    const { id: campaignId, postId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const post = await db.post.findFirst({ where: { id: postId, campaignId } });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const parsed = trackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const { enabled } = parsed.data;
    const now = new Date();

    const updated = await db.post.update({
      where: { id: postId },
      data: enabled
        ? { trackingEnabled: true, trackingStartedAt: now }
        : { trackingEnabled: false, trackingStartedAt: null },
      select: { id: true, trackingEnabled: true, trackingStartedAt: true },
    });

    if (enabled) {
      try {
        const metrics = await fetchPostMetrics(post.postUrl);
        if (metrics && hasMetricCounts(metrics)) {
          const views = metrics.viewsCount ?? 0;
          const likes = metrics.likesCount ?? 0;
          const comments = metrics.commentsCount ?? 0;
          const shares = metrics.sharesCount ?? 0;
          const engagementRate =
            metrics.engagementRate ?? (views > 0 ? ((likes + comments) / views) * 100 : 0);

          await db.$transaction([
            db.post.update({
              where: { id: postId },
              data: {
                viewsCount: views,
                likesCount: likes,
                commentsCount: comments,
                sharesCount: shares,
                engagementRate,
                lastSyncedAt: now,
              },
            }),
            db.postMetricSnapshot.create({
              data: {
                postId,
                viewsCount: views,
                likesCount: likes,
                commentsCount: comments,
                sharesCount: shares,
                engagementRate,
                syncSource: "track-enable",
              },
            }),
          ]);
        }
      } catch (err) {
        console.error(`Failed initial tracking fetch for post ${postId}:`, err);
      }
    }

    return NextResponse.json({
      trackingEnabled: updated.trackingEnabled,
      trackingStartedAt: updated.trackingStartedAt,
    });
  } catch (error) {
    console.error("Failed to toggle post tracking:", error);
    return NextResponse.json({ error: "Failed to toggle tracking" }, { status: 500 });
  }
}
