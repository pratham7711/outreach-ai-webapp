import { db } from "../lib/db";

async function main() {
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT c.id, c.title,
           COUNT(p.id)                                        AS posts,
           COUNT(p."lastSyncedAt")                            AS synced,
           COUNT(*) FILTER (WHERE p."likesCount" > 0)         AS with_likes
      FROM "Campaign" c
      JOIN "Post" p ON p."campaignId" = c.id
     GROUP BY c.id, c.title
    HAVING COUNT(p.id) BETWEEN 5 AND 40
     ORDER BY COUNT(p."lastSyncedAt") DESC, COUNT(p.id) DESC
     LIMIT 6`;
  console.table(
    rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]),
      ),
    ),
  );
}

main().then(() => process.exit(0));
