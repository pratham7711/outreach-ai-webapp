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
 * from the data cannot serve a figure the data has moved past -- when a row is
 * written its updatedAt moves the key, and the old entry is never addressed
 * again.
 *
 * Every model these endpoints read carries an @updatedAt that Prisma sets on
 * every update, and no code path writes Post, Campaign, Creator or Activation
 * with raw SQL (checked 2026-10-03). Prisma takes that time from the writing
 * server's clock, not the database's, so the stamp sums the times rather than
 * taking their max: under clock skew between two functions a later write can
 * carry an earlier time and leave max() where it was, but it still changes the
 * row's own value and so the sum. count(*) catches deletes.
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
      (SELECT count(*)::text || ':' || coalesce(sum(extract(epoch FROM p."updatedAt")::numeric)::text, '')
         FROM "Post" p JOIN "Campaign" c ON c.id = p."campaignId"
        WHERE c."orgId" = ${orgId}) AS posts,
      (SELECT count(*)::text || ':' || coalesce(sum(extract(epoch FROM "updatedAt")::numeric)::text, '')
         FROM "Campaign" WHERE "orgId" = ${orgId}) AS campaigns,
      (SELECT count(*)::text || ':' || coalesce(sum(extract(epoch FROM "updatedAt")::numeric)::text, '')
         FROM "Creator" WHERE "orgId" = ${orgId}) AS creators,
      CASE WHEN ${parts.activations === true} THEN
        (SELECT count(*)::text || ':' || coalesce(sum(extract(epoch FROM a."updatedAt")::numeric)::text, '')
           FROM "Activation" a JOIN "Campaign" c ON c.id = a."campaignId"
          WHERE c."orgId" = ${orgId})
      END AS activations,
      CASE WHEN ${parts.viewsSnapshots === true} THEN
        (SELECT count(*)::text || ':' || coalesce(sum(extract(epoch FROM "recordedAt")::numeric)::text, '')
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
