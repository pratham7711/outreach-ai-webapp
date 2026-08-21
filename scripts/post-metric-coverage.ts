import { db } from "../lib/db";

/**
 * The metric columns are `Float @default(0)`, so the schema cannot say
 * "unknown". This asks whether the freshness stamps can: if a post whose
 * metrics were never refreshed is exactly the post reading 0, the stamps are a
 * sound discriminator and no migration is needed.
 */
async function main() {
  const rows = await db.$queryRaw<Record<string, bigint>[]>`
    SELECT "lastFreshAt" IS NOT NULL  AS fresh_stamped,
           "lastSyncedAt" IS NOT NULL AS synced_stamped,
           COUNT(*)                                       AS posts,
           COUNT(*) FILTER (WHERE "likesCount"     > 0)   AS likes_pos,
           COUNT(*) FILTER (WHERE "viewsCount"     > 0)   AS views_pos,
           COUNT(*) FILTER (WHERE "engagementRate" > 0)   AS er_pos
      FROM "Post"
     GROUP BY 1, 2
     ORDER BY 3 DESC`;
  console.table(
    rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]),
      ),
    ),
  );
}

main().then(() => process.exit(0));
