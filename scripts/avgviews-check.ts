import { db } from "../lib/db";

async function main() {
  const names = ["James Kim", "David Osei", "Alex Turner", "Maria Santos", "Emma Chen"];
  for (const name of names) {
    const c = await db.creator.findFirst({ where: { name }, select: { id: true, name: true, averageViews: true, avatarUrl: true } });
    if (!c) { console.log(`  ${name}: NOT FOUND`); continue; }
    const agg = await db.post.aggregate({
      where: { creatorId: c.id, viewsCount: { gt: 0 } },
      _avg: { viewsCount: true },
      _count: true,
    });
    const total = await db.post.count({ where: { creatorId: c.id } });
    console.log(`  ${c.name}: stored=${c.averageViews} posts=${total} postsWithViews=${agg._count} derivedAvg=${agg._avg.viewsCount} avatar=${c.avatarUrl ? "yes" : "no"}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => process.exit(0));
