/**
 * Is Creator.followersCount actually populated? The Followers filter and column
 * are only meaningful if it is, and averageViews turned out to be dead for
 * 1,833 of 1,834 rows.
 *
 *   npx tsx scripts/followers-distribution.ts
 */
import { db } from "@/lib/db";

async function main() {
  const total = await db.creator.count({ where: { deletedAt: null } });
  const buckets = await db.$queryRawUnsafe<{ bucket: string; n: bigint }[]>(
    `SELECT CASE
              WHEN "followersCount" = 0 THEN 'zero'
              WHEN "followersCount" < 10000 THEN '<10k'
              WHEN "followersCount" < 100000 THEN '10k-100k'
              WHEN "followersCount" < 1000000 THEN '100k-1M'
              ELSE '1M+'
            END AS bucket, COUNT(*) AS n
       FROM "Creator" WHERE "deletedAt" IS NULL GROUP BY 1 ORDER BY 2 DESC`
  );
  console.log(`creators: ${total}`);
  for (const b of buckets) {
    const n = Number(b.n);
    console.log(`  ${b.bucket.padEnd(9)} ${String(n).padStart(6)}  ${((n / total) * 100).toFixed(1)}%`);
  }
}

main().then(() => process.exit(0));
