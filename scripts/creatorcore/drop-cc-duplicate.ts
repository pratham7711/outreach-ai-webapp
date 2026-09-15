/**
 * Reclaim the 27.7 MB that the CreatorCore importer wrote down twice.
 *
 *   npx tsx scripts/creatorcore/drop-cc-duplicate.ts           # report only
 *   npx tsx scripts/creatorcore/drop-cc-duplicate.ts --apply   # write
 *
 * The importer mirrors every CreatorCore record into CcPost / CcCampaign as
 * `raw`, and THEN wrote the same object a second time into the app row's own
 * JSON bag -- `Post.platformMetrics.__cc` and `Campaign.typeConfig.__cc`. The
 * second copy is what this removes. Measured before writing anything:
 *
 *   Post.platformMetrics   27.58 MB total, of which __cc is 25.65 MB (93%)
 *   Campaign.typeConfig     2.07 MB total, of which __cc is 2.05 MB (99%)
 *
 * and it was never a cache of something cheaper to reach -- it was the same
 * bytes. 18,638 of 18,638 posts and 506 of 506 campaigns carrying `__cc` join
 * to a mirror row whose `raw` compares equal, and no runtime code has ever read
 * the key: the only mentions outside the importer are one doc comment and three
 * test fixtures. It was also 39.5% of every campaign posts-list response, so
 * this is a wire saving as much as a storage one.
 *
 * The guard is the whole point of doing this as a script rather than one UPDATE.
 * A row is only stripped where the mirror row EXISTS and its `raw` is equal to
 * the copy being deleted, compared in the database rather than in JS -- so the
 * delete is provably lossless per row, and a row whose mirror is missing or has
 * drifted is left alone and counted. That distinction is the difference between
 * a cleanup and a data loss, and it is the reason the earlier rounded-views
 * repair had to be reverted: that one assumed two numbers measured the same
 * thing instead of checking.
 *
 * Reaches Neon over HTTPS, so it runs with the tunnel up. Read-only unless
 * --apply is passed. Production has no DATABASE_URL on a laptop by design; run
 * this against prod through the admin route, not from here.
 */
import { readFileSync } from "node:fs";

const APPLY = process.argv.includes("--apply");

const CONN = /^DATABASE_URL="?([^"\n]+)"?$/m.exec(readFileSync(".env.local", "utf8"))?.[1];
if (!CONN) throw new Error("no DATABASE_URL in .env.local");
const HOST = new URL(CONN).hostname;

async function sql<T = Record<string, string>>(query: string): Promise<T[]> {
  const res = await fetch(`https://${HOST}/sql`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Neon-Connection-String": CONN!,
      "Neon-Raw-Text-Output": "true",
      "Neon-Array-Mode": "false",
    },
    body: JSON.stringify({ query, params: [] }),
    signal: AbortSignal.timeout(300_000),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`neon http ${res.status}: ${body.slice(0, 400)}`);
  return JSON.parse(body).rows as T[];
}

/** One table's duplicate, and the mirror that makes deleting it safe. */
type Target = {
  label: string;
  table: string;
  column: string;
  /** Joins the app row to the mirror row that must already hold the same bytes. */
  join: string;
  /** True only when the mirror is present AND equal to the copy we would delete. */
  recoverable: string;
};

const TARGETS: Target[] = [
  {
    label: "Post.platformMetrics.__cc",
    table: "Post",
    column: "platformMetrics",
    join: `LEFT JOIN "CcPost" m ON m."ccId" = t."ccPostId"`,
    recoverable: `m."raw" IS NOT NULL AND m."raw" = t."platformMetrics"->'__cc'`,
  },
  {
    label: "Campaign.typeConfig.__cc",
    table: "Campaign",
    column: "typeConfig",
    join: `LEFT JOIN "CcCampaign" m ON m."ccId" = t."ccCampaignId"`,
    recoverable: `m."raw" IS NOT NULL AND m."raw" = t."typeConfig"->'__cc'`,
  },
];

const MB = (bytes: string | number) => (Number(bytes) / 1_048_576).toFixed(2);

async function main() {
  console.log(APPLY ? "APPLY -- writing\n" : "DRY RUN -- nothing is written (pass --apply)\n");

  let reclaimed = 0;
  let skipped = 0;

  for (const target of TARGETS) {
    const [before] = await sql(`
      SELECT
        count(*)                                        AS rows,
        coalesce(sum(pg_column_size(t."${target.column}"->'__cc')), 0) AS dup_bytes,
        count(*) FILTER (WHERE ${target.recoverable})    AS recoverable,
        count(*) FILTER (WHERE NOT (${target.recoverable})) AS unsafe
      FROM "${target.table}" t ${target.join}
      WHERE t."${target.column}" ? '__cc'
    `);

    console.log(`### ${target.label}`);
    console.log(`    rows carrying the duplicate : ${before.rows}`);
    console.log(`    duplicated bytes            : ${MB(before.dup_bytes)} MB`);
    console.log(`    provably recoverable        : ${before.recoverable}`);
    console.log(`    mirror missing or drifted   : ${before.unsafe}`);

    if (Number(before.rows) === 0) {
      console.log(`    nothing to do\n`);
      continue;
    }

    if (!APPLY) {
      console.log(`    would strip ${before.recoverable} rows, leave ${before.unsafe}\n`);
      reclaimed += Number(before.dup_bytes);
      skipped += Number(before.unsafe);
      continue;
    }

    /* Strip only where the mirror already holds the identical object. The
       subquery re-checks that per row at write time rather than trusting the
       count above, so a concurrent importer run cannot widen what is deleted. */
    const stripped = await sql(`
      WITH safe AS (
        SELECT t.id
        FROM "${target.table}" t ${target.join}
        WHERE t."${target.column}" ? '__cc' AND ${target.recoverable}
      )
      UPDATE "${target.table}" u
      SET "${target.column}" = u."${target.column}" - '__cc'
      FROM safe
      WHERE u.id = safe.id
      RETURNING 1 AS stripped
    `);

    const [size] = await sql(
      `SELECT coalesce(sum(pg_column_size("${target.column}")), 0) AS bytes FROM "${target.table}"`,
    );
    const [left] = await sql(
      `SELECT count(*) AS rows FROM "${target.table}" WHERE "${target.column}" ? '__cc'`,
    );

    console.log(`    stripped                    : ${stripped.length}`);
    console.log(`    still carrying __cc         : ${left.rows}`);
    console.log(`    ${target.table}.${target.column} now : ${MB(size.bytes)} MB\n`);
    reclaimed += Number(before.dup_bytes);
    skipped += Number(before.unsafe);
  }

  console.log(
    APPLY
      ? `Reclaimed ~${MB(reclaimed)} MB. Left ${skipped} row(s) whose mirror was missing or had drifted.`
      : `Would reclaim ~${MB(reclaimed)} MB and leave ${skipped} row(s) untouched. Re-run with --apply.`,
  );
  console.log(`The deleted copy stays readable via Post.ccPostId -> CcPost.raw and Campaign.ccCampaignId -> CcCampaign.raw.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
