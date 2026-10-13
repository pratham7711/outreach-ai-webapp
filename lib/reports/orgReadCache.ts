import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import { createLogger } from "@/lib/observability/logger";

/**
 * A server-side cache for the org-wide read endpoints (Analytics, the
 * dashboard's figures), keyed by the org's own data rather than by time.
 *
 * Measured on production 2026-10-03, read-only, for the largest org: the
 * duplicate scan those endpoints start with took 200ms, and the aggregates
 * behind it ~90-110ms each, in a wave -- every view, for numbers that move only
 * when a sync or an edit writes something. The stamp below costs one pass
 * (88ms in the same measurement) and replaces all of it whenever nothing moved.
 *
 * Keyed by data, not invalidated by a call, for the reason
 * lib/reports/campaignPerformance gives: revalidateTag does not reach
 * unstable_cache entries in Next 16.2 with cacheComponents off. A key derived
 * from the data cannot serve a figure the data has moved past -- when a column
 * the reads use is written the key moves, and the old entry is never addressed
 * again.
 *
 * Keyed on the columns the reads use, not on updatedAt. The stamp used to sum
 * each row's updatedAt, which every write moves -- including the ones these
 * figures never see, and the background jobs make those constantly: every
 * failed post read writes its __lastFetch note and syncFailCount, every sweep
 * stamps Campaign.lastRefreshAt, every tracker pass stamps the creator's
 * trackerLastAttemptAt. Each one threw away every cached Analytics and
 * dashboard result for the org, so the cache missed across hours in which no
 * figure changed. Now:
 *
 * - Post: the five counters and lastSyncedAt are summed (lastSyncedAt is what
 *   separates a measured zero from an unread one, and applyPostMetrics -- the
 *   one writer of __measured on an existing post -- stamps it in the same
 *   write), postedAt is summed, and creator, campaign, platform and URL are
 *   hashed. __measured itself is left out: reading it detoasts each post's
 *   whole platformMetrics bag, importer copy included, which measured 100-170ms
 *   on the 18,676-post org against 28ms for this.
 * - Campaign: title, status, createdAt, deletedAt. Creator: name, handle,
 *   platform, avatarUrl, followersCount, deletedAt. Activation: campaign,
 *   creator, deletedAt. OrgViewsSnapshot: day, viewsCount, postsCount.
 *
 * A read that starts depending on another column must add it here, or it can
 * serve that column stale for up to the revalidate window below.
 *
 * Sums rather than max(): two rows changing in one window cannot hide behind
 * each other, and count(*) catches deletes. Measured 2026-10-13 on the
 * read-only prod copy, largest org (18,676 posts), server-side EXPLAIN
 * ANALYZE: posts 28ms (was 17ms), creators 5.5ms (was 0.9ms), the rest under
 * 1ms -- about 16ms more per view, against a miss that runs the whole read.
 */

const BUILD_KEY = process.env.VERCEL_DEPLOYMENT_ID ?? "local";

/** The tables a read depends on beyond posts, campaigns and creators, which
 *  every org-wide read does. */
export type OrgStampParts = {
  activations?: boolean;
  viewsSnapshots?: boolean;
};

/**
 * A short string that changes whenever anything the read depends on changes.
 *
 * Posts are counted through their campaign, deleted campaigns included: a
 * soft delete is a Campaign update and moves that half of the stamp anyway.
 */
export async function orgDataStamp(orgId: string, parts: OrgStampParts = {}): Promise<string> {
  const rows = await db.$queryRaw<
    { posts: string; campaigns: string; creators: string; activations: string | null; views: string | null }[]
  >`
    SELECT
      /* The counters are summed as the floats they are stored as. They hold
         whole numbers (0 fractional values among every post on the prod copy,
         2026-10-13), which a float adds exactly in any order, so the sum does
         not move with the scan order; casting to numeric for safety cost 50ms.
         A fractional count could only ever cost a needless miss, never a stale
         hit. format() keeps each sum in its own slot when one is NULL. */
      (SELECT count(*)::text || ':' || format('%s,%s,%s,%s,%s,%s,%s,%s',
                sum(p."viewsCount"), sum(p."likesCount"), sum(p."commentsCount"),
                sum(p."sharesCount"), sum(p."savesCount"),
                sum(extract(epoch FROM p."lastSyncedAt")::numeric),
                sum(extract(epoch FROM p."postedAt")::numeric),
                sum(hashtextextended(concat_ws('|', p."creatorId", p."campaignId", p.platform, p."postUrl"), 0)))
         FROM "Post" p JOIN "Campaign" c ON c.id = p."campaignId"
        WHERE c."orgId" = ${orgId}) AS posts,
      (SELECT count(*)::text || ':' || coalesce(sum(hashtextextended(ROW(id, title, status, "createdAt", "deletedAt")::text, 0))::text, '')
         FROM "Campaign" WHERE "orgId" = ${orgId}) AS campaigns,
      (SELECT count(*)::text || ':' || coalesce(sum(hashtextextended(ROW(id, name, handle, platform, "avatarUrl", "followersCount", "deletedAt")::text, 0))::text, '')
         FROM "Creator" WHERE "orgId" = ${orgId}) AS creators,
      CASE WHEN ${parts.activations === true} THEN
        (SELECT count(*)::text || ':' || coalesce(sum(hashtextextended(ROW(a.id, a."campaignId", a."creatorId", a."deletedAt")::text, 0))::text, '')
           FROM "Activation" a JOIN "Campaign" c ON c.id = a."campaignId"
          WHERE c."orgId" = ${orgId})
      END AS activations,
      CASE WHEN ${parts.viewsSnapshots === true} THEN
        (SELECT count(*)::text || ':' || coalesce(sum(hashtextextended(ROW(day, "viewsCount", "postsCount")::text, 0))::text, '')
           FROM "OrgViewsSnapshot" WHERE "orgId" = ${orgId})
      END AS views
  `;
  const r = rows[0];
  if (!r) throw new Error("org stamp returned no row");
  return [r.posts, r.campaigns, r.creators, r.activations ?? "-", r.views ?? "-"].join("|");
}

/**
 * Serve `compute` from the cache when the org's data has not moved since it
 * last ran with these parameters; run it otherwise.
 *
 * `keyParts` must hold every request parameter the result depends on. orgId is
 * always in the key, so one org can never be served another's entry.
 *
 * A stamp that cannot be read is a reason to compute, never to serve: without
 * it there is no way to know the entry is current.
 */
export async function cachedOrgRead<T>(
  name: string,
  orgId: string,
  keyParts: readonly string[],
  parts: OrgStampParts,
  compute: () => Promise<T>,
): Promise<T> {
  // No org, no shared key: never let two callers without one meet in the cache.
  if (!orgId) return compute();

  let stamp: string;
  try {
    stamp = await orgDataStamp(orgId, parts);
  } catch (err) {
    createLogger({ context: { lib: "reports/orgReadCache", name } }).warn("stamp unreadable; computing uncached", {
      error: err instanceof Error ? err.message : String(err),
    });
    return compute();
  }

  const cached = unstable_cache(compute, [name, BUILD_KEY, orgId, ...keyParts, stamp], {
    /* An entry is unreachable once the stamp moves, so it only has to outlive
       the views that share a stamp. Tagged so a deploy or an operator can still
       drop the lot. */
    tags: [`${name}:${orgId}`],
    revalidate: 3600,
  });
  try {
    return await cached();
  } catch (err) {
    /* unstable_cache needs Next's incremental cache in the surrounding context;
       jest and scripts have none, and there a missing cache just means
       compute. Same brittle match as lib/reports/campaignPerformance: if it
       ever stops matching, the error surfaces as it would have without it. */
    if (!(err instanceof Error) || !err.message.includes("incrementalCache missing")) throw err;
    return compute();
  }
}

/** The UTC hour, for reads whose default window slides with the clock: a
 *  six-month view computed at 10:05 is still that view at 10:55. */
export function utcHourKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 13);
}
