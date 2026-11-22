// The two tables behind album tracking: SongSpotifyAlbum, a song's linked
// Spotify album (one per song, instead of a linked track), and
// SongStreamTrackReading, one reading a day of each track on that album.
//
// Every statement is idempotent because the same DDL runs from two places: the
// tracked Prisma migration, and /api/admin/migrate-song-albums for production,
// which has no usable _prisma_migrations lineage (never `migrate deploy`
// there).
//
// Additive only: two new tables, no column on Song, so no existing query names
// them and the order of deploy and DDL does not matter. Until they exist an
// album link cannot be saved (the routes say so) and nothing reads one.

export const SONG_ALBUM_TABLES = ["SongSpotifyAlbum", "SongStreamTrackReading"] as const;

export const SONG_ALBUM_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "SongSpotifyAlbum" (
    "songId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "albumId" TEXT NOT NULL,
    "albumName" TEXT,
    "albumArtists" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SongSpotifyAlbum_pkey" PRIMARY KEY ("songId")
  )`,
  `CREATE INDEX IF NOT EXISTS "SongSpotifyAlbum_orgId_idx" ON "SongSpotifyAlbum"("orgId")`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SongSpotifyAlbum_songId_fkey') THEN
      ALTER TABLE "SongSpotifyAlbum" ADD CONSTRAINT "SongSpotifyAlbum_songId_fkey"
        FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
  `CREATE TABLE IF NOT EXISTS "SongStreamTrackReading" (
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
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SongStreamTrackReading_songId_day_trackId_key" ON "SongStreamTrackReading"("songId", "day", "trackId")`,
  `CREATE INDEX IF NOT EXISTS "SongStreamTrackReading_songId_albumId_day_idx" ON "SongStreamTrackReading"("songId", "albumId", "day")`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SongStreamTrackReading_songId_fkey') THEN
      ALTER TABLE "SongStreamTrackReading" ADD CONSTRAINT "SongStreamTrackReading_songId_fkey"
        FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];

/** A query failed because one of the album tables is not there yet. */
export function isMissingSongAlbumTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return code === "P2021" || /(SongSpotifyAlbum|SongStreamTrackReading).*does not exist|relation "(SongSpotifyAlbum|SongStreamTrackReading)"/i.test(message);
}
