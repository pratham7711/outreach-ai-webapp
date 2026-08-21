/**
 * Analytics reports a 0.05 average engagement rate across 18.7k posts, which is
 * either a fraction masquerading as a percentage or a column nobody populated.
 * Same question that exposed Creator.averageViews and followersCount.
 *
 *   npx tsx --env-file=.env scripts/engagement-rate-check.ts
 */
import { db } from "@/lib/db";

async function main() {
  const total = await db.post.count();
  const rows = await db.$queryRawUnsafe<{ bucket: string; n: bigint }[]>(
    `SELECT CASE
              WHEN "engagementRate" = 0 THEN 'zero'
              WHEN "engagementRate" < 1 THEN '0-1'
              WHEN "engagementRate" < 10 THEN '1-10'
              ELSE '10+'
            END AS bucket, COUNT(*) AS n
       FROM "Post" GROUP BY 1 ORDER BY 2 DESC`
  );
  console.log(`posts: ${total}`);
  for (const r of rows) {
    const n = Number(r.n);
    console.log(`  ${r.bucket.padEnd(6)} ${String(n).padStart(6)}  ${((n / total) * 100).toFixed(1)}%`);
  }

  // Where the column IS set, does it agree with the raw counts on the same row?
  const sample = await db.post.findMany({
    where: { engagementRate: { gt: 0 }, viewsCount: { gt: 0 } },
    select: {
      engagementRate: true,
      viewsCount: true,
      likesCount: true,
      commentsCount: true,
      sharesCount: true,
      savesCount: true,
    },
    take: 3,
  });
  for (const p of sample) {
    const derived =
      ((p.likesCount + p.commentsCount + p.sharesCount + p.savesCount) / p.viewsCount) * 100;
    console.log(`  stored ${p.engagementRate.toFixed(4)}  derived ${derived.toFixed(4)}%`);
  }

  // The question that decides whether it can be derived: on the rows where the
  // rate is 0, are the underlying counts there?
  const dead = await db.post.count({ where: { engagementRate: 0 } });
  const withViews = await db.post.count({ where: { engagementRate: 0, viewsCount: { gt: 0 } } });
  const withLikes = await db.post.count({ where: { engagementRate: 0, likesCount: { gt: 0 } } });
  console.log(`\nrate=0 rows: ${dead}`);
  console.log(`  of those, views > 0: ${withViews} (${((withViews / dead) * 100).toFixed(1)}%)`);
  console.log(`  of those, likes > 0: ${withLikes} (${((withLikes / dead) * 100).toFixed(1)}%)`);

  const totals = await db.post.aggregate({
    _sum: {
      viewsCount: true,
      likesCount: true,
      commentsCount: true,
      sharesCount: true,
      savesCount: true,
    },
  });
  const s = totals._sum;
  const orgRate =
    ((s.likesCount! + s.commentsCount! + s.sharesCount! + s.savesCount!) / s.viewsCount!) * 100;
  console.log(`\nrate derived from all summed counts: ${orgRate.toFixed(3)}%`);
}

main().then(() => process.exit(0));
