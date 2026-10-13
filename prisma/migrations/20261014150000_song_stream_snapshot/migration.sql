CREATE TABLE IF NOT EXISTS "SongStreamSnapshot" (
    "id" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "spotifyTrackId" TEXT,
    "trackName" TEXT,
    "trackArtists" TEXT,
    "playCount" BIGINT,
    "failure" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SongStreamSnapshot_pkey" PRIMARY KEY ("id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "SongStreamSnapshot_songId_day_key" ON "SongStreamSnapshot"("songId", "day");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SongStreamSnapshot_songId_fkey') THEN
      ALTER TABLE "SongStreamSnapshot" ADD CONSTRAINT "SongStreamSnapshot_songId_fkey"
        FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
