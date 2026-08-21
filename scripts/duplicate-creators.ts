/**
 * The activation picker showed "Blessing Jolie" twice: a seeded row with handle
 * "@blessingjolie" and an imported one with "blessingjolie". Handles are stored
 * unnormalised, so the import could not dedupe against what was already there.
 * How widespread is it?
 *
 *   npx tsx --env-file=.env scripts/duplicate-creators.ts
 */
import { db } from "@/lib/db";

async function main() {
  const rows = await db.$queryRawUnsafe<{ key: string; n: bigint; ids: string; handles: string }[]>(
    `SELECT lower(ltrim("handle", '@')) AS key,
            COUNT(*) AS n,
            string_agg(id, ' | ') AS ids,
            string_agg("handle", ' | ') AS handles
       FROM "Creator"
      WHERE "deletedAt" IS NULL
      GROUP BY 1
     HAVING COUNT(*) > 1
      ORDER BY 2 DESC, 1`
  );
  const total = await db.creator.count({ where: { deletedAt: null } });
  const dupRows = rows.reduce((s, r) => s + Number(r.n), 0);
  console.log(`creators: ${total}`);
  console.log(`handles appearing more than once: ${rows.length} (covering ${dupRows} rows)`);
  for (const r of rows.slice(0, 15)) {
    console.log(`  ${r.key}  x${Number(r.n)}  handles: ${r.handles}`);
  }

  // Does anything actually point at both rows of a pair? That is what makes a
  // merge risky rather than cosmetic.
  for (const r of rows.slice(0, 5)) {
    const ids = r.ids.split(" | ");
    const counts = await Promise.all(
      ids.map(async (id) => ({
        id,
        posts: await db.post.count({ where: { creatorId: id } }),
        activations: await db.activation.count({ where: { creatorId: id } }),
      }))
    );
    console.log(`  ${r.key}:`, counts.map((c) => `${c.id}=${c.posts}p/${c.activations}a`).join("  "));
  }
}

main().then(() => process.exit(0));
