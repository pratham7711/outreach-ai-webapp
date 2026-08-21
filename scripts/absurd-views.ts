import { db } from "../lib/db";

/** Which posts carry impossible view counts, and where did they come from? */
async function main() {
  const worst = await db.post.findMany({
    where: { viewsCount: { gt: 100_000_000 } },
    select: {
      id: true, viewsCount: true, platform: true, postUrl: true, platformPostId: true,
      lastSyncedAt: true, createdAt: true, thumbnailUrl: true,
      creator: { select: { name: true, handle: true } },
    },
    orderBy: { viewsCount: "desc" },
    take: 12,
  });
  console.log(`  posts over 100M views: ${await db.post.count({ where: { viewsCount: { gt: 100_000_000 } } })}`);
  console.log(`  posts over 1B views:   ${await db.post.count({ where: { viewsCount: { gt: 1_000_000_000 } } })}`);
  console.log(`  total posts:           ${await db.post.count()}`);
  for (const p of worst) {
    console.log(`  ${p.viewsCount} ${p.platform} ${p.creator?.name} url=${p.postUrl ? "yes" : "NONE"} ppid=${p.platformPostId ?? "NONE"} synced=${p.lastSyncedAt ? "yes" : "never"} thumb=${p.thumbnailUrl ? "yes" : "no"}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => process.exit(0));
