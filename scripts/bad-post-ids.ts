import { db } from "../lib/db";

/**
 * TikTok and YouTube players are addressed by id. The CreatorCore import parsed
 * some post URLs wrongly and stored the literal path segment ("video", "p",
 * "reel") as platformPostId, so the embed URL became .../embed/v2/video and the
 * player could never load. Count the damage per platform.
 */
async function main() {
  const rows = await db.$queryRawUnsafe<{ platform: string; n: bigint; bad: bigint; recoverable: bigint }[]>(`
    SELECT "platform"::text AS platform,
           COUNT(*)::bigint AS n,
           COUNT(*) FILTER (WHERE "platformPostId" !~ '^[0-9]+$')::bigint AS bad,
           COUNT(*) FILTER (
             WHERE "platformPostId" !~ '^[0-9]+$'
               AND "postUrl" ~ '/video/[0-9]+'
           )::bigint AS recoverable
    FROM "Post"
    GROUP BY 1 ORDER BY 2 DESC
  `);
  console.log(`  ${"platform".padEnd(11)} ${"posts".padStart(7)} ${"non-numeric id".padStart(15)} ${"fixable from url".padStart(17)}`);
  for (const r of rows) {
    console.log(
      `  ${r.platform.padEnd(11)} ${String(r.n).padStart(7)} ${String(r.bad).padStart(15)} ${String(r.recoverable).padStart(17)}`
    );
  }

  const samples = await db.$queryRawUnsafe<{ platformPostId: string; postUrl: string }[]>(`
    SELECT "platformPostId", "postUrl" FROM "Post"
    WHERE "platform" = 'TIKTOK' AND "platformPostId" !~ '^[0-9]+$' LIMIT 4
  `);
  console.log("\n  examples of the broken ids:");
  for (const s of samples) console.log(`    id=${JSON.stringify(s.platformPostId)}  url=${s.postUrl}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
