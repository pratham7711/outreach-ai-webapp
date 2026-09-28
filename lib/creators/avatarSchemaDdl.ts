// The CreatorAvatar table. Every statement is idempotent because the same DDL
// runs from two places: the tracked Prisma migration, and
// /api/admin/migrate-creator-avatars for production, which has no usable
// _prisma_migrations lineage (never `migrate deploy` there).
//
// Additive only: a new table nothing else depends on. The code that reads it
// treats a missing table as "no stored picture", so the order of deploy and
// DDL does not matter.

export const CREATOR_AVATAR_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "CreatorAvatar" (
    "creatorId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "data" BYTEA,
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failure" TEXT,
    CONSTRAINT "CreatorAvatar_pkey" PRIMARY KEY ("creatorId")
  )`,
  `CREATE INDEX IF NOT EXISTS "CreatorAvatar_orgId_idx" ON "CreatorAvatar"("orgId")`,
  `CREATE INDEX IF NOT EXISTS "CreatorAvatar_fetchedAt_idx" ON "CreatorAvatar"("fetchedAt")`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorAvatar_creatorId_fkey') THEN
      ALTER TABLE "CreatorAvatar" ADD CONSTRAINT "CreatorAvatar_creatorId_fkey"
        FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];
