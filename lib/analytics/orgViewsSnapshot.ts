import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";

/**
 * Record what every organisation's posts had earned, once a day.
 *
 * "Checks all posts views of the organisation" means reading the view count this
 * database holds for every post, not re-fetching 18,690 posts from four
 * platforms. Re-fetching is what the hourly sync-posts cron already does, under
 * a budget and behind rate gates, and doing it for every post daily would be
 * tens of thousands of platform calls a day against APIs that block for less.
 * So the sync crons keep the numbers current and this takes the reading.
 *
 * The distinction matters for how the chart should be read: a point is "what our
 * records said at 03:30 UTC that day", which is the freshest figure available
 * and lags real life by however long since each post was last synced. That is
 * the honest claim, and it is the one the chart now makes.
 */

/** UTC midnight for a moment. The day key has to agree with @db.Date. */
export function utcDayOf(when: Date): Date {
  return new Date(Date.UTC(when.getUTCFullYear(), when.getUTCMonth(), when.getUTCDate()));
}

export type OrgViewsRollupResult = {
  orgs: number;
  written: number;
  skipped: number;
};

type Totals = {
  orgId: string;
  views: number;
  likes: number;
  comments: number;
  posts: number;
};

/**
 * One grouped query for every org, rather than a query per org.
 *
 * Post has no orgId of its own, so the tenant boundary is the join through
 * Campaign -- the same route every other aggregate in this app takes.
 *
 * Soft-deleted campaigns are excluded. The old derived chart did not exclude
 * them, which disagreed with the campaign list and with the "Active campaigns"
 * tile beside it; deleting a campaign should take its delivery out of the
 * headline number, or deleting means nothing.
 */
export async function readOrgViewTotals(): Promise<Totals[]> {
  const rows = await db.$queryRaw<
    { orgId: string; views: number | null; likes: number | null; comments: number | null; posts: bigint }[]
  >`
    SELECT c."orgId"                          AS "orgId",
           COALESCE(SUM(p."viewsCount"), 0)    AS views,
           COALESCE(SUM(p."likesCount"), 0)    AS likes,
           COALESCE(SUM(p."commentsCount"), 0) AS comments,
           COUNT(*)                            AS posts
      FROM "Post" p
      JOIN "Campaign" c ON c.id = p."campaignId"
     WHERE c."deletedAt" IS NULL
     GROUP BY 1
  `;

  return rows.map((r) => ({
    orgId: r.orgId,
    views: Number(r.views ?? 0),
    likes: Number(r.likes ?? 0),
    comments: Number(r.comments ?? 0),
    posts: Number(r.posts),
  }));
}

/**
 * @param now the clock for this run; the day key comes from it.
 * @param dryRun compute and report without writing.
 *
 * Upsert on (orgId, day), so a retry or a manual re-run replaces the day's
 * reading rather than adding a second one. Re-running late in the day therefore
 * moves that day's point forward, which is correct: it is still "the reading we
 * took that day", just a later one.
 */
export async function snapshotOrgViews(
  { now = new Date(), dryRun = false }: { now?: Date; dryRun?: boolean } = {}
): Promise<OrgViewsRollupResult> {
  const log = createLogger({ context: { job: "snapshot-org-views" } });
  const day = utcDayOf(now);

  const totals = await readOrgViewTotals();
  let written = 0;
  let skipped = 0;

  for (const t of totals) {
    /* An org with no posts at all is skipped rather than written as a zero.
       A zero row is indistinguishable from a real measurement of zero once it
       is in the table, and it would draw a flat line along the bottom of the
       chart for an org that has simply not started yet -- which reads as "your
       posts have no views" rather than "there is nothing to show". */
    if (t.posts === 0) {
      skipped++;
      continue;
    }

    if (dryRun) {
      written++;
      continue;
    }

    await db.orgViewsSnapshot.upsert({
      where: { orgId_day: { orgId: t.orgId, day } },
      update: {
        viewsCount: t.views,
        likesCount: t.likes,
        commentsCount: t.comments,
        postsCount: t.posts,
        recordedAt: now,
      },
      create: {
        orgId: t.orgId,
        day,
        viewsCount: t.views,
        likesCount: t.likes,
        commentsCount: t.comments,
        postsCount: t.posts,
        recordedAt: now,
      },
    });
    written++;
  }

  log.info("org views snapshot complete", {
    day: day.toISOString().slice(0, 10),
    orgs: totals.length,
    written,
    skipped,
    dryRun,
  });

  return { orgs: totals.length, written, skipped };
}
