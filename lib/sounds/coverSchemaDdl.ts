// The SoundCover table. Every statement is idempotent because the same DDL
// runs from two places: the tracked Prisma migration, and
// /api/admin/migrate-sound-covers for production, which has no usable
// _prisma_migrations lineage (never `migrate deploy` there).
//
// Additive only: a new table nothing else depends on. The code that reads it
// treats a missing table as "no stored picture", so the order of deploy and
// DDL does not matter -- the contract PostThumbnail
// (lib/posts/thumbnailSchemaDdl.ts) and CreatorAvatar already follow.

export const SOUND_COVER_TABLE = "SoundCover";

export const SOUND_COVER_COLUMNS = ["data", "failedAt", "failure", "fetchedAt", "orgId", "soundId", "sourceUrl"];

export const SOUND_COVER_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "SoundCover" (
    "soundId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "data" BYTEA,
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failure" TEXT,
    CONSTRAINT "SoundCover_pkey" PRIMARY KEY ("soundId")
  )`,
  `CREATE INDEX IF NOT EXISTS "SoundCover_orgId_idx" ON "SoundCover"("orgId")`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SoundCover_soundId_fkey') THEN
      ALTER TABLE "SoundCover" ADD CONSTRAINT "SoundCover_soundId_fkey"
        FOREIGN KEY ("soundId") REFERENCES "TikTokSound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];
