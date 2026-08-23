/**
 * Create the indexes in schema.prisma that the database is missing.
 *
 * Exists because production has no _prisma_migrations table -- it was built with
 * `db push` -- so `migrate deploy` must never be run against it. This applies
 * exactly the four indexes and nothing else, under the names Prisma generates,
 * so a later `db push` sees them as already present and does nothing.
 *
 * CONCURRENTLY, so writes are never blocked. IF NOT EXISTS, so it is safe to
 * run twice.
 *
 *   node --env-file=.env scripts/create-missing-indexes.mjs
 */
import pg from "pg";

const INDEXES = [
  // Post is the largest table and every campaign screen filters on campaignId.
  ['Post_campaignId_idx', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Post_campaignId_idx" ON "Post" ("campaignId")'],
  ['Post_creatorId_idx', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "Post_creatorId_idx" ON "Post" ("creatorId")'],
  // PostMetricSnapshot had nothing but its primary key.
  ['PostMetricSnapshot_postId_idx', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "PostMetricSnapshot_postId_idx" ON "PostMetricSnapshot" ("postId")'],
  ['PostMetricSnapshot_postId_recordedAt_idx', 'CREATE INDEX CONCURRENTLY IF NOT EXISTS "PostMetricSnapshot_postId_recordedAt_idx" ON "PostMetricSnapshot" ("postId", "recordedAt")'],
];

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Run with --env-file=.env");
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

try {
  for (const [name, sql] of INDEXES) {
    const started = process.hrtime.bigint();
    await db.query(sql);
    console.log(`${name.padEnd(42)} ${(Number(process.hrtime.bigint() - started) / 1e6).toFixed(0)}ms`);
  }
  // Without this the planner keeps its old row estimates and may ignore them.
  for (const table of ["Post", "PostMetricSnapshot"]) await db.query(`ANALYZE "${table}"`);
  console.log("ANALYZE done.");
} finally {
  await db.end();
}
