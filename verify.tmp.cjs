const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  const q = `SELECT c.handle, c.platform,
    (SELECT count(*)::int FROM "CreatorTrackerSnapshot" s WHERE s."creatorId"=c.id) AS snaps,
    (SELECT to_char(max(s."recordedAt"),$$HH24:MI:SS$$) FROM "CreatorTrackerSnapshot" s WHERE s."creatorId"=c.id) AS last,
    (SELECT s2."followersCount"::bigint FROM "CreatorTrackerSnapshot" s2 WHERE s2."creatorId"=c.id ORDER BY s2."recordedAt" DESC LIMIT 1) AS followers,
    CASE WHEN c."topPosts" IS NULL THEN 0 ELSE jsonb_array_length(c."topPosts"::jsonb) END AS tp,
    to_char(c."trackerLastAttemptAt",$$HH24:MI:SS$$) AS attempt,
    c."trackerLastError" AS err
    FROM "Creator" c WHERE c."trackedSince" IS NOT NULL ORDER BY c.platform, c.handle`;
  const r = await pool.query(q);
  for (const x of r.rows) console.log(x.handle.padEnd(14), x.platform.padEnd(8), "snaps="+String(x.snaps).padEnd(2), "last="+(x.last||"-").padEnd(9), "followers="+String(x.followers??"-").padEnd(9), "topPosts="+x.tp, "attempt="+(x.attempt||"-"), x.err?("| "+x.err.slice(0,50)):"| ok");
  await pool.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
