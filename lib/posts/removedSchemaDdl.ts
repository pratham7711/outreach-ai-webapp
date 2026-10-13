// Post.removedAt / Post.removedById and the index that serves them. Every
// statement is idempotent, so it can be run again on a database that already
// has them.
//
// Additive only: two nullable columns and an index. Old code ignores unknown
// nullable columns, so this DDL goes to production BEFORE the code that reads
// it -- every campaign posts read filters on removedAt once that code is live,
// and a missing column would then fail the read rather than fall back. That
// ordering is why there is no missing-column fallback in the readers and no
// admin migrate route: the orchestrator applies these statements first.
//
// Never `db push` / `migrate deploy` (see CLAUDE.md): production's migration
// lineage does not build from scratch.

export const POST_REMOVED_DDL: string[] = [
  `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "removedAt" TIMESTAMP(3)`,
  `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "removedById" TEXT`,
  `CREATE INDEX IF NOT EXISTS "Post_campaignId_removedAt_idx" ON "Post"("campaignId", "removedAt")`,
];
