import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { computeVelocities, detectBotSignals } from "@/lib/fraud/botSignals";

type RouteParams = { params: Promise<{ id: string; postId: string }> };

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await authenticateRequest(request);
    if (!authResult) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = authResult;
    const { id: campaignId, postId } = await params;

    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const post = await db.post.findFirst({
      where: { id: postId, campaignId },
      select: { id: true, trackingEnabled: true, trackingStartedAt: true },
    });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    const rows = await db.postMetricSnapshot.findMany({
      where: { postId },
      orderBy: { recordedAt: "asc" },
      select: {
        id: true,
        viewsCount: true,
        likesCount: true,
        commentsCount: true,
        sharesCount: true,
        engagementRate: true,
        recordedAt: true,
      },
    });

    const series = rows.map((r) => ({
      recordedAt: r.recordedAt.toISOString(),
      viewsCount: r.viewsCount,
      likesCount: r.likesCount,
      commentsCount: r.commentsCount,
      sharesCount: r.sharesCount,
    }));

    return NextResponse.json({
      trackingEnabled: post.trackingEnabled ?? false,
      trackingStartedAt: post.trackingStartedAt,
      snapshots: rows.map((r) => ({
        id: r.id,
        recordedAt: r.recordedAt.toISOString(),
        viewsCount: r.viewsCount,
        likesCount: r.likesCount,
        commentsCount: r.commentsCount,
        sharesCount: r.sharesCount,
        engagementRate: r.engagementRate,
      })),
      velocities: computeVelocities(series),
      botSignals: detectBotSignals(series),
    });
  } catch (error) {
    console.error("Failed to load post timeseries:", error);
    return NextResponse.json({ error: "Failed to load timeseries" }, { status: 500 });
  }
}
