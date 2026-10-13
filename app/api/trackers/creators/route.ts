import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { isTrackerWindow, type TrackerWindow } from "@/lib/trackers/metrics";
import { READ_CADENCE_HOURS, downsample, effectiveChartGranularity, parseGranularity } from "@/lib/trackers/granularity";
import { parseTrackerError, READ_FAILURE_COPY } from "@/lib/platforms/creatorProfile";
import { trackerLimitError, trackerUsage } from "@/lib/trackers/limit";
import {
  byMetricDescending,
  isCreatorTrackerSort,
  metricsFromRow,
  toNumber,
  windowBounds,
  type CreatorTrackerSort,
  type CreatorWindowRow,
} from "@/lib/trackers/creatorMetrics";
import {
  figuresFor,
  mergeReadings,
  parsePaging,
  parseSearch,
  readAnchorReadings,
} from "@/lib/trackers/creatorPage";
import { requirePermission } from "@/lib/authz";

/**
 * The Creators half of the Trackers page (?sub=creator in the reference).
 *
 * Both windows come from one grouped aggregate over Post. A watchlist is small,
 * but the post table is 18,708 rows and growing, and this page's sibling routes
 * already learned what reading it into Node costs.
 *
 * Paged (plan §12 F3): `page` and `pageSize` (default 50, at most 200) and a
 * server-side `q` over name and handle. The order is decided over every
 * tracked creator before the page is cut -- sorting one page would leave the
 * biggest creator on page 9 -- from one row per creator; only the page's own
 * creators have their readings read. lib/trackers/creatorPage.ts has why.
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

const INSTAGRAM_FOLLOWERS_ONLY =
  "Instagram shares views only with Business and Creator accounts, and it did not answer for this one, so we read the follower count from one of the creator's own posts. A post shows followers, not average views.";

export async function GET(req: NextRequest) {
  try {
    const result = await authenticateRequest(req);
    if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { orgId } = result;

    const params = req.nextUrl.searchParams;
    const period = parseWindow(params.get("period"));
    const sort = parseSort(params.get("sort"));
    const paging = parsePaging(params);
    const q = parseSearch(params.get("q"));
    // One clock for the whole request: the window bounds, the read-health cutoff
    // and the change maths must all agree on when "now" is.
    const now = new Date();
    const bounds = windowBounds(period, now);
    const empty = {
      creators: [],
      period,
      sort,
      windows: CREATOR_WINDOWS,
      q,
      page: 1,
      pageSize: paging.pageSize,
      pageCount: 0,
      total: 0,
    };

    /* The org's chart setting and the tracked list do not depend on each
       other, so they are read in one wave; so are the window aggregates and
       the anchor readings below, which need only the ids. Four round trips
       in a row became two before the page read. */
    const orgRead = db.organization.findUnique({
      where: { id: orgId },
      select: { uiConfig: true },
    });

    /* Every tracked creator, but only what ranking needs from the row itself.
       Newest-tracked first is the order a tie keeps, as it always was; the id
       makes that order total, so a tie cannot straddle a page boundary and
       hand one creator back twice. */
    const trackedRead = db.creator.findMany({
      where: {
        orgId,
        deletedAt: null,
        trackedSince: { not: null },
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" as const } },
                { handle: { contains: q, mode: "insensitive" as const } },
              ],
            }
          : {}),
      },
      select: { id: true, followersCount: true },
      orderBy: [{ trackedSince: "desc" }, { id: "asc" }],
    });
    const [org, tracked] = await Promise.all([orgRead, trackedRead]);
    const granularity = parseGranularity(org?.uiConfig ?? null);
    const chartAt = effectiveChartGranularity(granularity);

    if (tracked.length === 0) return NextResponse.json(empty);
    const trackedIds = tracked.map((c) => c.id);

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
     *
     * Over every tracked creator rather than the page, because Posts is one
     * of the sorts. It returns one small row per creator who posted.
     */
    const rowsRead = db.$queryRawUnsafe<
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
      trackedIds
    );
    const [rows, anchors] = await Promise.all([rowsRead, readAnchorReadings(orgId, trackedIds, bounds.current)]);

    const byCreator = new Map<string, CreatorWindowRow>(
      (rows ?? []).map((r) => [
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

    const ranked = byMetricDescending(
      tracked.map((c) => {
        const f = figuresFor(anchors.get(c.id) ?? [], c.followersCount, period, now);
        return {
          id: c.id,
          followersCount: f.followersCount,
          views: f.views,
          metrics: metricsFromRow(byCreator.get(c.id)),
        };
      }),
      sort
    );

    const total = ranked.length;
    const pageCount = Math.ceil(total / paging.pageSize);
    // Past the end (the last creator on the last page was just untracked) is
    // the last page, not an empty one.
    const page = Math.min(paging.page, pageCount);
    const pageIds = ranked.slice((page - 1) * paging.pageSize, page * paging.pageSize).map((r) => r.id);

    /* The page's own readings: only the selected window, pushed into the SQL.
       A nested `take` here would not bound the read (Prisma pages a to-many
       relation in memory), so the bound is the WHERE. Anything older that the
       figures can still need -- the latest reading of a creator not read this
       window, a baseline from before it -- is in the anchors, merged below. */
    const pageRows = await db.creator.findMany({
      where: { id: { in: pageIds }, orgId, deletedAt: null, trackedSince: { not: null } },
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
          where: { recordedAt: { gte: bounds.current } },
          orderBy: { recordedAt: "desc" },
          select: { followersCount: true, avgViews: true, postsCount: true, recordedAt: true },
        },
      },
    });
    const pageById = new Map(pageRows.map((c) => [c.id, c]));

    const creators = pageIds.flatMap((id) => {
      const c = pageById.get(id);
      if (!c) return [];
      const readings = mergeReadings(c.trackerSnapshots, anchors.get(c.id) ?? []);
      const f = figuresFor(readings, c.followersCount, period, now);

      /* A read that failed is not the same as a read that has not happened.
         Instagram will never return figures for a personal account, and saying
         so is more useful than a permanent blank. */
      /* The stored string carries the platform's reason and, where a fallback
         rung looked, what it saw. Both reach the reader: the copy says what
         kind of failure it is, the note says which of this creator's posts it
         tried and what it found there, and only the second distinguishes a
         renamed handle from one whose posts are simply gone. */
      const failure = c.trackerLastError ? parseTrackerError(c.trackerLastError) : null;
      const readError = failure
        ? [
            READ_FAILURE_COPY[failure.reason] ?? "We could not read this creator's figures.",
            failure.note ? `We also looked at their own posts: ${failure.note}.` : null,
          ]
            .filter(Boolean)
            .join(" ")
        : null;

      /* An Instagram account Business Discovery cannot read still gets a
         follower reading, from the embed of one of its own posts -- which
         carries no lifetime post count (so it is stored as 0) and no views.
         The views are not late, they are not available, and the generic
         "posts are read once a day" would tell the reader to wait. */
      const latest = c.trackerSnapshots[0];
      const viewsNote =
        f.views.avgViews === null && !readError && c.platform === "INSTAGRAM" && latest?.postsCount === 0
          ? INSTAGRAM_FOLLOWERS_ONLY
          : null;

      return [
        {
          id: c.id,
          name: c.name,
          handle: c.handle,
          platform: c.platform,
          avatarUrl: c.avatarUrl,
          trackedSince: c.trackedSince,
          followersCount: f.followersCount,
          followersFromReading: f.followersFromReading,
          followersChangePercent: f.followersChangePercent,
          followersDelta: f.followersDelta,
          /* The creator's own ten newest posts, from the same readings as the
             follower figure; the change is withheld on the same health rule. */
          views: f.views,
          lastReadAt: f.lastReadAt,
          lastAttemptAt: c.trackerLastAttemptAt,
          health: f.health,
          readError,
          viewsNote,
          series: downsample(f.followerHistory, chartAt).map((s) => ({
            value: s.value,
            recordedAt: s.recordedAt,
          })),
          chartGranularity: chartAt,
          /* Readings inside the selected window, plus the latest ones before
             it. Zero still means never read and one still means read once. */
          snapshotCount: readings.length,
          /* Passed through as stored; the sweep wrote it in TopPost shape and the
             client treats it as display data, not something to recompute. */
          topPosts: c.topPosts ?? null,
          topPostsAt: c.topPostsAt,
          /* Which claim the list makes -- the creator's own catalogue, or only
             the posts this workspace runs with them. The panel says so. */
          topPostsSource: c.topPostsSource ?? null,
          /* This workspace's own posts with the creator: a narrower claim than
             `views`, kept for the Posts sort and labelled as such in the panel. */
          metrics: metricsFromRow(byCreator.get(c.id)),
        },
      ];
    });

    return NextResponse.json({
      /* Already in ranked order; sorted once more on the page's full figures,
         which agree with the anchors' and break any tie the same way. */
      creators: byMetricDescending(creators, sort),
      period,
      sort,
      windows: CREATOR_WINDOWS,
      q,
      page,
      pageSize: paging.pageSize,
      pageCount,
      total,
      /* The org's read cadence in hours, so the page can call a reading
         stale past twice it (plan A6, lib/dataAge) rather than guess. */
      readCadenceHours: READ_CADENCE_HOURS[granularity.readCadence],
    });
  } catch (error) {
    console.error("Failed to fetch creator trackers:", error);
    return NextResponse.json({ error: "Failed to fetch creator trackers" }, { status: 500 });
  }
}

const trackSchema = z.object({ creatorId: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    /* Creator tracking is a roster write: creators:create, as tracking in bulk
       (trackers/creators/bulk) already requires. */
    const gate = await requirePermission(req, "creators:create");
    if (!gate.ok) return gate.response;
    const result = gate.auth;
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

    /* The same gate the sound route has, against the same limit.
       A tracked creator is a standing instruction to fetch a profile on a
       schedule — exactly what lib/plans.ts says max_trackers exists to bound —
       but this route had no check at all, so a free org (max 0) could track
       every creator it owned and the sound route's 409 was the only cap in the
       product. Counted together, because there is one limit, not two. */
    const usage = await trackerUsage(orgId);
    const limitError = trackerLimitError(usage, "creators");
    if (limitError) {
      return NextResponse.json(
        { error: limitError, trackers: { used: usage.used, max: usage.max } },
        { status: 409 }
      );
    }

    /* Stamped as attempted now, so the creator joins the BACK of the reading
       queue: the sweep reads oldest attempt first with nulls first, and a
       null here would put this one ahead of every creator already waiting
       (plan F3). Refresh in the detail panel reads it at once if wanted. */
    const now = new Date();
    await db.creator.update({ where: { id: creator.id }, data: { trackedSince: now, trackerLastAttemptAt: now } });
    return NextResponse.json({ tracked: true }, { status: 201 });
  } catch (error) {
    console.error("Failed to track creator:", error);
    return NextResponse.json({ error: "Failed to track creator" }, { status: 500 });
  }
}
