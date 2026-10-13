// The PostThumbnail table. Every statement is idempotent because the same DDL
// runs from two places: the tracked Prisma migration, and
// /api/admin/migrate-post-thumbnails for production, which has no usable
// _prisma_migrations lineage (never `migrate deploy` there).
//
// Additive only: a new table nothing else depends on. The code that reads it
// treats a missing table as "no stored picture", so the order of deploy and
// DDL does not matter -- the same contract as CreatorAvatar
// (lib/creators/avatarSchemaDdl.ts), which this copies.
//
// No fetchedAt index, unlike CreatorAvatar: nothing here sweeps by age. A
// post's cover does not change under the same image key, so there is no
// fortnightly re-read to order, and the backfill finds its work by joining
// Post to this table on the primary key.

export const POST_THUMBNAIL_TABLE = "PostThumbnail";

export const POST_THUMBNAIL_COLUMNS = ["data", "failedAt", "failure", "fetchedAt", "orgId", "postId", "sourceUrl"];

export const POST_THUMBNAIL_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "PostThumbnail" (
    "postId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "data" BYTEA,
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failure" TEXT,
    CONSTRAINT "PostThumbnail_pkey" PRIMARY KEY ("postId")
  )`,
  `CREATE INDEX IF NOT EXISTS "PostThumbnail_orgId_idx" ON "PostThumbnail"("orgId")`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostThumbnail_postId_fkey') THEN
      ALTER TABLE "PostThumbnail" ADD CONSTRAINT "PostThumbnail_postId_fkey"
        FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];
