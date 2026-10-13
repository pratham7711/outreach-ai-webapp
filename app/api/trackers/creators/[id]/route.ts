import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { downsample, effectiveChartGranularity, parseGranularity } from "@/lib/trackers/granularity";
import { LATEST_TEN_SINCE } from "@/lib/trackers/recentViews";
import { requirePermission } from "@/lib/authz";

/** Enough history for the panel's 30-Day Change to find a baseline. */
const HISTORY_DAYS = 31;
/** A four-hourly cadence writes ~190 readings in 31 days; this is far past it. */
const HISTORY_ROWS = 2000;

/**
 * One tracked creator's history, for the detail panel's charts and its 7-, 14-
 * and 30-day changes. The list only loads the selected period's readings, so a
 * 30-Day Change computed from those would be the period's change mislabelled.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;
    const { id } = await params;

    const since = new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000);
    const [creator, org] = await Promise.all([
      db.creator.findFirst({
        where: { id, orgId, deletedAt: null, trackedSince: { not: null } },
        select: {
          id: true,
          trackerSnapshots: {
            where: { recordedAt: { gte: since } },
            orderBy: { recordedAt: "asc" },
            take: HISTORY_ROWS,
            select: { followersCount: true, avgViews: true, recordedAt: true },
          },
        },
      }),
      db.organization.findUnique({ where: { id: orgId }, select: { uiConfig: true } }),
    ]);
    if (!creator) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

    const chartAt = effectiveChartGranularity(parseGranularity(org?.uiConfig ?? null));
    const points = (rows: { value: number; recordedAt: Date }[]) =>
      downsample(rows, chartAt).map((p) => ({ value: p.value, recordedAt: p.recordedAt }));

    return NextResponse.json({
      /* A 0 is a reading that did not carry the count (plan A1), not a point. */
      followers: points(
        creator.trackerSnapshots
          .filter((s) => s.followersCount > 0)
          .map((s) => ({ value: s.followersCount, recordedAt: s.recordedAt }))
      ),
      /* Only readings that measured views, and only since the ten-newest-posts
         definition began: an older reading averaged a different set of posts. */
      views: points(
        creator.trackerSnapshots
          .filter((s) => s.avgViews > 0 && s.recordedAt >= LATEST_TEN_SINCE)
          .map((s) => ({ value: s.avgViews, recordedAt: s.recordedAt }))
      ),
      chartGranularity: chartAt,
    });
  } catch (error) {
    console.error("Failed to fetch creator tracker history:", error);
    return NextResponse.json({ error: "Failed to fetch creator tracker history" }, { status: 500 });
  }
}

/**
 * Stop tracking a creator.
 *
 * This clears a flag. It does not delete the creator, their posts or their
 * activations — untracking is a change to a watchlist, and the sound tracker's
 * DELETE (which does remove its rows) is not the precedent to follow here,
 * because a TikTokSound exists only to be tracked and a Creator does not.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    /* Creator tracking is a roster write: creators:create, as tracking in bulk
       (trackers/creators/bulk) already requires. */
    const gate = await requirePermission(req, "creators:create");
    if (!gate.ok) return gate.response;
    const result = gate.auth;
    const { orgId } = result;
    const { id } = await params;

    const creator = await db.creator.findFirst({
      where: { id, orgId, deletedAt: null },
      select: { id: true, name: true, trackedSince: true },
    });
    if (!creator) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

    // Untracking twice is the same outcome as untracking once.
    if (creator.trackedSince) {
      await db.creator.update({ where: { id: creator.id }, data: { trackedSince: null } });
      /* Logged: it stops a standing read and drops the date the watch began,
         which tracking the creator again does not restore. */
      await logAudit({
        orgId,
        userId: result.userId ?? undefined,
        actorEmail: result.actorEmail ?? undefined,
        actorType: result.actorType,
        action: "tracker.creator_untrack",
        entityType: "creator",
        entityId: creator.id,
        entityLabel: creator.name,
        ipAddress: getRequestIp(req),
        before: { trackedSince: creator.trackedSince.toISOString() },
        after: { trackedSince: null },
      });
    }

    return NextResponse.json({ tracked: false });
  } catch (error) {
    console.error("Failed to untrack creator:", error);
    return NextResponse.json({ error: "Failed to untrack creator" }, { status: 500 });
  }
}
