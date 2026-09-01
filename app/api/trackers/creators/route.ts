import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import {
  changeOverWindow,
  isMeasurable,
  isTrackerWindow,
  readHealthFor,
  windowHours,
  type TrackerSnapshot,
  type TrackerWindow,
} from "@/lib/trackers/metrics";
import {
  downsample,
  effectiveChartGranularity,
  parseGranularity,
  snapshotFetchLimit,
} from "@/lib/trackers/granularity";
import { READ_FAILURE_COPY, type CreatorReadFailure } from "@/lib/platforms/creatorProfile";
import {
  byMetricDescending,
  followerCount,
  isCreatorTrackerSort,
  metricsFromRow,
  toNumber,
  windowBounds,
  type CreatorTrackerSort,
  type CreatorWindowRow,
} from "@/lib/trackers/creatorMetrics";

/**
 * The Creators half of the Trackers page (?sub=creator in the reference).
 *
 * Both windows come from one grouped aggregate over Post. A watchlist is small,
 * but the post table is 18,708 rows and growing, and this page's sibling routes
 * already learned what reading it into Node costs.
 */

// The reference offers 7 / 14 / 30 days on this tab and no 24h, which is too
// short a window to say anything about a posting cadence.
const CREATOR_WINDOWS: TrackerWindow[] = ["7d", "14d", "30d"];

function parseWindow(value: string | null): TrackerWindow {
  return value && isTrackerWindow(value) && CREATOR_WINDOWS.includes(value) ? value : "7d";
}

function parseSort(value: string | null): CreatorTrackerSort {
  return isCreatorTrackerSort(value) ? value : "views";
}

export async function GET(req: NextRequest) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const period = parseWindow(req.nextUrl.searchParams.get("period"));
    const sort = parseSort(req.nextUrl.searchParams.get("sort"));
    // One clock for the whole request: the window bounds, the read-health cutoff
    // and the change maths must all agree on when "now" is.
    const now = new Date();
    const bounds = windowBounds(period, now);

    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { uiConfig: true },
    });
    const granularity = parseGranularity(org?.uiConfig ?? null);
    const windowDays = windowHours(period) / 24;
    const chartAt = effectiveChartGranularity(granularity);

    const tracked = await db.creator.findMany({
      where: { orgId, deletedAt: null, trackedSince: { not: null } },
      select: {
        id: true,
        name: true,
        handle: true,
        platform: true,
        avatarUrl: true,
        followersCount: true,
        trackedSince: true,
        trackerLastAttemptAt: true,
        trackerLastError: true,
        topPosts: true,
        topPostsAt: true,
        topPostsSource: true,
        trackerSnapshots: {
          orderBy: { recordedAt: "desc" },
          take: snapshotFetchLimit(granularity, windowDays),
          select: { followersCount: true, avgViews: true, recordedAt: true },
        },
      },
      orderBy: { trackedSince: "desc" },
    });

    if (tracked.length === 0) {
      return NextResponse.json({ creators: [], period, sort, windows: CREATOR_WINDOWS });
    }

    /*
     * Scoped through Campaign.orgId, not through the id list alone: a creator can
     * appear on more than one org's campaigns, and the view counts of someone
     * else's campaign are not ours to average.
     *
     * The cut-offs go in as ISO strings cast to timestamp. Prisma maps DateTime
     * to timestamp(3) WITHOUT time zone, so "postedAt" holds a naive UTC wall
     * time; handing pg a Date sends an offset-bearing literal whose offset
     * Postgres then discards, shifting the boundary by the server's zone. The
     * ::timestamp cast on a trailing-Z string keeps the comparison in UTC.
     */
    const rows = await db.$queryRawUnsafe<
      {
        creatorId: string;
        avgCurrent: unknown;
        postsCurrent: unknown;
        avgPrevious: unknown;
        postsPrevious: unknown;
      }[]
    >(
      `SELECT p."creatorId" AS "creatorId",
              avg(p."viewsCount") FILTER (WHERE p."postedAt" >= $2::timestamp) AS "avgCurrent",
              count(*)            FILTER (WHERE p."postedAt" >= $2::timestamp) AS "postsCurrent",
              avg(p."viewsCount") FILTER (WHERE p."postedAt" <  $2::timestamp) AS "avgPrevious",
              count(*)            FILTER (WHERE p."postedAt" <  $2::timestamp) AS "postsPrevious"
         FROM "Post" p
         JOIN "Campaign" c ON c.id = p."campaignId"
        WHERE c."orgId" = $1
          AND c."deletedAt" IS NULL
          AND p."creatorId" = ANY($4::text[])
          AND p."postedAt" >= $3::timestamp
        GROUP BY 1`,
      orgId,
      bounds.current.toISOString(),
      bounds.previous.toISOString(),
      tracked.map((c) => c.id)
    );

    const byCreator = new Map<string, CreatorWindowRow>(
      rows.map((r) => [
        r.creatorId,
        {
          creatorId: r.creatorId,
          avgCurrent: toNumber(r.avgCurrent),
          postsCurrent: toNumber(r.postsCurrent) ?? 0,
          avgPrevious: toNumber(r.avgPrevious),
          postsPrevious: toNumber(r.postsPrevious) ?? 0,
        },
      ])
    );

    const creators = tracked.map((c) => {
      /* Follower history, newest-first from the query, mapped into the shape the
         shared window maths expects. Until the sweep has run twice for a creator
         this is empty or single-valued, and changeOverWindow correctly returns
         null rather than inventing a baseline. */
      const followerHistory: TrackerSnapshot[] = c.trackerSnapshots.map((s) => ({
        value: s.followersCount,
        recordedAt: s.recordedAt,
      }));
      const latest = c.trackerSnapshots[0] ?? null;
      const followerChange = changeOverWindow(followerHistory, period, now);

      /* Age is served with the figure, never separately -- the same rule as the
         sound tracker, learned the same way: a change computed from two readings
         nine days old is arithmetically fine and completely misleading. */
      const lastReadAt = latest?.recordedAt ?? null;
      const health = readHealthFor(lastReadAt, now);
      const measurable = isMeasurable(health);

      /* A read that failed is not the same as a read that has not happened.
         Instagram will never return figures for a personal account, and saying
         so is more useful than a permanent blank. */
      const reason = (c.trackerLastError ?? "").split(":")[0] as CreatorReadFailure;
      const readError = c.trackerLastError
        ? READ_FAILURE_COPY[reason] ?? "We could not read this creator's figures."
        : null;

      return {
        id: c.id,
        name: c.name,
        handle: c.handle,
        platform: c.platform,
        avatarUrl: c.avatarUrl,
        trackedSince: c.trackedSince,
        /* Prefer the tracked reading over the denormalised column: the column is
           populated on 11 of 1,834 creators, so it is usually a default rather
           than a measurement. */
        followersCount: latest ? latest.followersCount : followerCount(c.followersCount),
        followersChangePercent: measurable ? followerChange?.percent ?? null : null,
        followersDelta: measurable ? followerChange?.added ?? null : null,
        lastReadAt,
        lastAttemptAt: c.trackerLastAttemptAt,
        health,
        readError,
        series: downsample(followerHistory, chartAt).map((s) => ({
          value: s.value,
          recordedAt: s.recordedAt,
        })),
        chartGranularity: chartAt,
        snapshotCount: c.trackerSnapshots.length,
        /* Passed through as stored; the sweep wrote it in TopPost shape and the
           client treats it as display data, not something to recompute. */
        topPosts: c.topPosts ?? null,
        topPostsAt: c.topPostsAt,
        /* Which claim the list makes -- the creator's own catalogue, or only
           the posts this workspace runs with them. The panel says so. */
        topPostsSource: c.topPostsSource ?? null,
        metrics: metricsFromRow(byCreator.get(c.id)),
      };
    });

    return NextResponse.json({
      creators: byMetricDescending(creators, sort),
      period,
      sort,
      windows: CREATOR_WINDOWS,
    });
  } catch (error) {
    console.error("Failed to fetch creator trackers:", error);
    return NextResponse.json({ error: "Failed to fetch creator trackers" }, { status: 500 });
  }
}

const trackSchema = z.object({ creatorId: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const parsed = trackSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    // The id arrives in the body, so it is proven to be ours before it is written.
    const creator = await db.creator.findFirst({
      where: { id: parsed.data.creatorId, orgId, deletedAt: null },
      select: { id: true, trackedSince: true },
    });
    if (!creator) return NextResponse.json({ error: "Creator not found" }, { status: 404 });

    // Tracking an already-tracked creator is not an error, and must not reset the
    // date -- that date is how long we have been watching.
    if (creator.trackedSince) {
      return NextResponse.json({ tracked: true, alreadyTracked: true });
    }

    await db.creator.update({ where: { id: creator.id }, data: { trackedSince: new Date() } });
    return NextResponse.json({ tracked: true }, { status: 201 });
  } catch (error) {
    console.error("Failed to track creator:", error);
    return NextResponse.json({ error: "Failed to track creator" }, { status: 500 });
  }
}
