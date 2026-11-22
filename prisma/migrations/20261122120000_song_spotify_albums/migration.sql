-- Album tracking: a song's linked Spotify album and a daily reading per album track.
-- Same statements as lib/songs/songAlbumDdl.ts (production runs them via /api/admin/migrate-song-albums).

CREATE TABLE IF NOT EXISTS "SongSpotifyAlbum" (
    "songId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "albumName" TEXT,
    "albumArtists" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SongSpotifyAlbum_pkey" PRIMARY KEY ("songId")
  );

CREATE INDEX IF NOT EXISTS "SongSpotifyAlbum_orgId_idx" ON "SongSpotifyAlbum"("orgId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SongSpotifyAlbum_songId_fkey') THEN
      ALTER TABLE "SongSpotifyAlbum" ADD CONSTRAINT "SongSpotifyAlbum_songId_fkey"
        FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "SongStreamTrackReading" (
    "id" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "albumId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "trackName" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "playCount" BIGINT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SongStreamTrackReading_pkey" PRIMARY KEY ("id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "SongStreamTrackReading_songId_day_trackId_key" ON "SongStreamTrackReading"("songId", "day", "trackId");

CREATE INDEX IF NOT EXISTS "SongStreamTrackReading_songId_albumId_day_idx" ON "SongStreamTrackReading"("songId", "albumId", "day");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SongStreamTrackReading_songId_fkey') THEN
      ALTER TABLE "SongStreamTrackReading" ADD CONSTRAINT "SongStreamTrackReading_songId_fkey"
        FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
