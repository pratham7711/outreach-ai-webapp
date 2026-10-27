-- Generated from lib/songs/songLinkDdl.ts; idempotent.
ALTER TABLE "Song" ADD COLUMN IF NOT EXISTS "spotifyTrackId" TEXT, ADD COLUMN IF NOT EXISTS "instagramSoundId" TEXT;

CREATE INDEX IF NOT EXISTS "Song_instagramSoundId_idx" ON "Song"("instagramSoundId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Song_instagramSoundId_fkey') THEN
    ALTER TABLE "Song" ADD CONSTRAINT "Song_instagramSoundId_fkey"
      FOREIGN KEY ("instagramSoundId") REFERENCES "TikTokSound"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
