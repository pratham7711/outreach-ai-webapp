// The SongStreamSnapshot table. Every statement is idempotent because the same
// DDL runs from two places: the tracked Prisma migration, and
// /api/admin/migrate-song-streams for production, which has no usable
// _prisma_migrations lineage (never `migrate deploy` there).
//
// Additive only: a new table, and no column on Song. The cron and the report
// both treat a missing table as "nothing tracked yet" -- the cron makes no
// Spotify call at all until it exists -- so the order of deploy and DDL does
// not matter. Same contract as PostThumbnail (lib/posts/thumbnailSchemaDdl.ts).

export const SONG_STREAM_TABLE = "SongStreamSnapshot";

export const SONG_STREAM_COLUMNS = [
  "day",
  "failure",
  "id",
  "orgId",
  "playCount",
  "recordedAt",
  "songId",
  "spotifyTrackId",
  "trackArtists",
  "trackName",
];

export const SONG_STREAM_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "SongStreamSnapshot" (
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
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SongStreamSnapshot_songId_day_key" ON "SongStreamSnapshot"("songId", "day")`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SongStreamSnapshot_songId_fkey') THEN
      ALTER TABLE "SongStreamSnapshot" ADD CONSTRAINT "SongStreamSnapshot_songId_fkey"
        FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];

export function isMissingSongStreamTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return code === "P2021" || /SongStreamSnapshot.*does not exist|relation "SongStreamSnapshot"/i.test(message);
}
