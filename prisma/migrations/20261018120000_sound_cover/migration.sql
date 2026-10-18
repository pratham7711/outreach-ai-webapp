CREATE TABLE IF NOT EXISTS "SoundCover" (
    "soundId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "data" BYTEA,
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failure" TEXT,
    CONSTRAINT "SoundCover_pkey" PRIMARY KEY ("soundId")
  );

CREATE INDEX IF NOT EXISTS "SoundCover_orgId_idx" ON "SoundCover"("orgId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SoundCover_soundId_fkey') THEN
      ALTER TABLE "SoundCover" ADD CONSTRAINT "SoundCover_soundId_fkey"
        FOREIGN KEY ("soundId") REFERENCES "TikTokSound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
