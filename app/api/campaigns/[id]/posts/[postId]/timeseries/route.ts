import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { computeVelocities, detectBotSignals } from "@/lib/fraud/botSignals";
import {
  downsample,
  effectiveChartGranularity,
  parsePostTracking,
} from "@/lib/trackers/granularity";
import { hoursRemaining } from "@/lib/sync/postTracking";

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
      select: {
        id: true,
        trackingEnabled: true,
        trackingStartedAt: true,
        trackingTtlDays: true,
        trackingExpiresAt: true,
      },
    });
    if (!post) return NextResponse.json({ error: "Post not found" }, { status: 404 });

    /* The same two-knob model the sound and creator trackers use: how often we
       READ is an operational budget, how densely we CHART is a display
       preference, and the chart may never be finer than the reader samples.
       Without the clamp a 4-hourly reader asked for an hourly chart draws one
       point per four hours on an hourly axis -- three gaps that look like
       outages but are just the cadence. */
    const granularity = parsePostTracking(
      (await db.organization.findUnique({ where: { id: orgId }, select: { uiConfig: true } }))
        ?.uiConfig ?? null,
    );
    const chartGranularity = effectiveChartGranularity(granularity);

    const allRows = await db.postMetricSnapshot.findMany({
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
    /* Last reading in a bucket wins, not the mean. Every counter here is a
       level -- the view count as at that moment -- so the close of a bucket is a
       state that was really observed, while an average of six readings is a
       number that was never true at any instant. */
    const rows = downsample(allRows, chartGranularity);

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
      trackingTtlDays: post.trackingTtlDays,
      trackingExpiresAt: post.trackingExpiresAt,
      /* Zero once the window has closed, so the panel can say "finished" rather
         than counting into the negatives. */
      hoursRemaining: post.trackingEnabled
        ? hoursRemaining({
            trackingEnabled: true,
            trackingStartedAt: post.trackingStartedAt,
            trackingExpiresAt: post.trackingExpiresAt,
            trackingTtlDays: post.trackingTtlDays,
            lastSyncedAt: null,
            syncDisabledAt: null,
            hasFinalSnapshot: false,
            granularity,
            now: new Date(),
          })
        : null,
      readCadence: granularity.readCadence,
      chartGranularity,
      /* How many raw readings exist behind the drawn points, so a thin chart
         reads as "downsampled" rather than as "barely collected". */
      rawSnapshotCount: allRows.length,
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
