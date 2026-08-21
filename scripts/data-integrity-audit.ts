import { db } from "../lib/db";

/**
 * Which numbers on screen are real?
 *
 * avgViews is a hand-editable column, not a derived metric -- nothing computes
 * it from the posts we actually hold. So the creator card can show 0 next to a
 * creator with millions of real views, and 180k next to one with none. Measure
 * the gap before deciding whether to derive it or stop showing it.
 */
async function main() {
  const creators = await db.creator.count();
  const withAvg = await db.creator.count({ where: { averageViews: { gt: 0 } } });
  const zeroAvg = await db.creator.count({ where: { averageViews: 0 } });
  const withPosts = await db.creator.count({ where: { posts: { some: {} } } });
  const postsNoAvg = await db.creator.count({ where: { posts: { some: {} }, averageViews: 0 } });
  const avgNoPosts = await db.creator.count({ where: { posts: { none: {} }, averageViews: { gt: 0 } } });

  console.log("=== creator.avgViews ===");
  console.log(`  creators                              ${creators}`);
  console.log(`  avgViews non-null                     ${withAvg}`);
  console.log(`  avgViews exactly 0                    ${zeroAvg}`);
  console.log(`  creators that have posts              ${withPosts}`);
  console.log(`  HAVE posts but avgViews is null       ${postsNoAvg}   <- shown as "—" despite real data`);
  console.log(`  NO posts but avgViews is set          ${avgNoPosts}   <- number with nothing behind it`);

  console.log("\n=== stored avgViews vs the real average from Post.views ===");
  const rows = await db.$queryRawUnsafe<
    { id: string; name: string; stored: number | null; real: number | null; posts: bigint }[]
  >(`
    SELECT c."id", c."name", c."averageViews" AS stored,
           ROUND(AVG(p."viewsCount"))::int AS real, COUNT(p."id")::bigint AS posts
    FROM "Creator" c JOIN "Post" p ON p."creatorId" = c."id"
    GROUP BY c."id", c."name", c."averageViews"
    HAVING COUNT(p."id") >= 3
    ORDER BY COUNT(p."id") DESC
    LIMIT 12
  `);
  console.log(`  ${"creator".padEnd(26)} ${"posts".padStart(6)} ${"stored".padStart(10)} ${"real avg".padStart(10)}`);
  for (const r of rows) {
    const stored = r.stored === null || r.stored === 0 ? "—" : String(r.stored);
    console.log(
      `  ${r.name.slice(0, 25).padEnd(26)} ${String(r.posts).padStart(6)} ${stored.padStart(10)} ${String(r.real ?? "—").padStart(10)}`
    );
  }

  console.log("\n=== do we have real view data to derive from? ===");
  const posts = await db.post.count();
  const viewsSet = await db.post.count({ where: { viewsCount: { gt: 0 } } });
  console.log(`  posts                                 ${posts}`);
  console.log(`  posts with views > 0                  ${viewsSet}  (${((viewsSet / posts) * 100).toFixed(1)}%)`);
  const agg = await db.post.aggregate({ _sum: { viewsCount: true, likesCount: true, commentsCount: true } });
  console.log(`  total views across all posts          ${agg._sum.viewsCount ?? 0}`);
  console.log(`  total likes                           ${agg._sum.likesCount ?? 0}`);
  console.log(`  total comments                        ${agg._sum.commentsCount ?? 0}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
