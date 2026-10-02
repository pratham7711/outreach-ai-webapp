import { db } from "@/lib/db";
import {
  changeOverWindow,
  isMeasurable,
  readHealthFor,
  type ReadHealth,
  type TrackerSnapshot,
  type TrackerWindow,
} from "./metrics";
import { followerCount, viewsFromSnapshots, type CreatorViews } from "./creatorMetrics";
import { LATEST_TEN_SINCE } from "./recentViews";

/**
 * The Creators tab of the Trackers page, one page at a time (plan §12 F3).
 *
 * The list used to load every tracked creator with a nested `take` of their
 * snapshots. Prisma applies a nested take on a to-many relation in memory,
 * after reading every child row of every parent (the client runtime's
 * in-memory pagination over `linkingFields`) -- so "the newest 60 per creator"
 * was every reading the agency had ever taken, about 185k rows for 1,850
 * creators, on every view of the page.
 *
 * It now reads in two steps. Ranking needs one row per creator, and gets it
 * from five LIMIT-1 probes on the (creatorId, recordedAt) index: the newest two
 * readings, the newest two that measured views, and the first reading inside
 * the window that measured views. Those are the only readings the list's own
 * maths can pick as a "latest" or a "baseline" for the figures it sorts on --
 * see anchorsCoverTheSortKeys in the tests -- so the order matches the full
 * computation. Only the page's own creators then have their window read, and
 * the anchors are merged in, because a creator last read before the window
 * still has a latest reading and must not be shown as never read.
 */

export const TRACKER_PAGE_SIZE_DEFAULT = 50;
export const TRACKER_PAGE_SIZE_MAX = 200;
/** Long enough for a name or a handle; a search is a filter, not a query language. */
const SEARCH_MAX = 100;

export function parsePaging(params: URLSearchParams): { page: number; pageSize: number } {
  const page = Number.parseInt(params.get("page") ?? "", 10);
  const size = Number.parseInt(params.get("pageSize") ?? "", 10);
  return {
    page: Number.isFinite(page) && page >= 1 ? page : 1,
    pageSize: Number.isFinite(size) && size >= 1 ? Math.min(size, TRACKER_PAGE_SIZE_MAX) : TRACKER_PAGE_SIZE_DEFAULT,
  };
}

export function parseSearch(value: string | null): string {
  return (value ?? "").trim().slice(0, SEARCH_MAX);
}

export type Reading = { followersCount: number; avgViews: number; recordedAt: Date };

/**
 * A timestamp as it arrives from a raw query. The pg adapter hands Prisma
 * `timestamp` columns as UTC already; a bare string without a zone is still
 * read as UTC here, because `new Date("2026-10-01T03:00:00")` is LOCAL time in
 * Node and would move every reading by the server's offset.
 */
function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== "string" || !value) return null;
  const zoned = /([zZ]|[+-]\d{2}(:?\d{2})?)$/.test(value) ? value : `${value.replace(" ", "T")}Z`;
  const d = new Date(zoned);
  return Number.isFinite(d.getTime()) ? d : null;
}

function reading(at: unknown, followers: unknown, views: unknown): Reading | null {
  const recordedAt = asDate(at);
  if (!recordedAt) return null;
  return { recordedAt, followersCount: Number(followers) || 0, avgViews: Number(views) || 0 };
}

/** One list of readings, newest first, each reading once. */
export function mergeReadings(...lists: readonly (readonly Reading[])[]): Reading[] {
  const byTime = new Map<number, Reading>();
  for (const list of lists) {
    for (const r of list) {
      const t = r.recordedAt.getTime();
      if (!byTime.has(t)) byTime.set(t, r);
    }
  }
  return [...byTime.values()].sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());
}

const ANCHOR_SLOTS = ["r1", "r2", "m1", "m2", "w"] as const;

/**
 * The anchor readings for each creator, keyed by id.
 *
 * `$3` is where a views baseline may start: the window's start, or the day the
 * ten-newest-posts definition began if that is later (LATEST_TEN_SINCE), since
 * an older reading averaged a different set of posts. The cut-off goes in as an
 * ISO string cast to timestamp for the reason the post aggregate gives in the
 * route: recordedAt is a naive UTC wall time.
 */
export async function readAnchorReadings(
  orgId: string,
  creatorIds: string[],
  windowStart: Date
): Promise<Map<string, Reading[]>> {
  const out = new Map<string, Reading[]>();
  if (creatorIds.length === 0) return out;
  const viewsFrom = windowStart > LATEST_TEN_SINCE ? windowStart : LATEST_TEN_SINCE;
  const probe = (alias: string, filter: string, order: "ASC" | "DESC", offset: number) =>
    `LEFT JOIN LATERAL (
       SELECT s."recordedAt", s."followersCount", s."avgViews"
         FROM "CreatorTrackerSnapshot" s
        WHERE s."creatorId" = c.id${filter}
        ORDER BY s."recordedAt" ${order}
        LIMIT 1 OFFSET ${offset}) ${alias} ON true`;
  const columns = ANCHOR_SLOTS.map(
    (a) => `${a}."recordedAt" AS "${a}At", ${a}."followersCount" AS "${a}Followers", ${a}."avgViews" AS "${a}Views"`
  ).join(",\n       ");
  const rows = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `SELECT c.id AS "id",
       ${columns}
       FROM "Creator" c
       ${probe("r1", "", "DESC", 0)}
       ${probe("r2", "", "DESC", 1)}
       ${probe("m1", ` AND s."avgViews" > 0`, "DESC", 0)}
       ${probe("m2", ` AND s."avgViews" > 0`, "DESC", 1)}
       ${probe("w", ` AND s."avgViews" > 0 AND s."recordedAt" >= $3::timestamp`, "ASC", 0)}
      WHERE c."orgId" = $1
        AND c.id = ANY($2::text[])`,
    orgId,
    creatorIds,
    viewsFrom.toISOString()
  );
  for (const row of rows ?? []) {
    if (typeof row?.id !== "string") continue;
    const readings = ANCHOR_SLOTS.map((a) => reading(row[`${a}At`], row[`${a}Followers`], row[`${a}Views`])).filter(
      (r): r is Reading => r !== null
    );
    out.set(row.id, mergeReadings(readings));
  }
  return out;
}

export type CreatorFigures = {
  followerHistory: TrackerSnapshot[];
  lastReadAt: Date | null;
  health: ReadHealth;
  followersCount: number | null;
  /** False when followersCount is the creator row's stored figure rather than
   *  a tracker reading -- an import, a hand edit or a roster refresh. */
  followersFromReading: boolean;
  followersChangePercent: number | null;
  followersDelta: number | null;
  views: CreatorViews;
};

/**
 * Every figure the list shows for one creator, from readings newest first.
 *
 * The one place the row maths lives, so ranking (on the anchors) and the page
 * (on the window plus the anchors) cannot drift apart.
 */
export function figuresFor(
  readings: readonly Reading[],
  storedFollowers: number | null | undefined,
  period: TrackerWindow,
  now: Date
): CreatorFigures {
  /* Follower history, mapped into the shape the shared window maths expects.
     Until the sweep has run twice for a creator this is empty or single-valued,
     and changeOverWindow correctly returns null rather than inventing a
     baseline.

     A reading of 0 followers did not carry the count (plan A1), so it is not
     part of the series: as the newest point it reads as a -100% change, and as
     the oldest one in a window as a gain of the creator's whole audience. */
  const counted = readings.filter((s) => s.followersCount > 0);
  const followerHistory: TrackerSnapshot[] = counted.map((s) => ({
    value: s.followersCount,
    recordedAt: s.recordedAt,
  }));
  const latest = counted[0] ?? readings[0] ?? null;
  const followerChange = changeOverWindow(followerHistory, period, now);
  const views = viewsFromSnapshots(readings, period, now);

  /* Age is served with the figure, never separately -- the same rule as the
     sound tracker, learned the same way: a change computed from two readings
     nine days old is arithmetically fine and completely misleading. */
  const lastReadAt = latest?.recordedAt ?? null;
  const health = readHealthFor(lastReadAt, now);
  const measurable = isMeasurable(health);

  return {
    followerHistory,
    lastReadAt,
    health,
    /* Prefer the tracked reading over the denormalised column: the column is
       populated on 11 of 1,834 creators, so it is usually a default rather
       than a measurement. */
    followersCount: counted[0] ? counted[0].followersCount : followerCount(storedFollowers),
    /* Said, so the card does not date a stored figure by a tracker read that
       never carried it: 74 tracked creators on production showed an imported
       count labelled "Tracker reading" (measured 2026-10-03). */
    followersFromReading: counted[0] !== undefined,
    followersChangePercent: measurable ? followerChange?.percent ?? null : null,
    followersDelta: measurable ? followerChange?.added ?? null : null,
    views: {
      ...views,
      changePercent: measurable ? views.changePercent : null,
      delta: measurable ? views.delta : null,
    },
  };
}
