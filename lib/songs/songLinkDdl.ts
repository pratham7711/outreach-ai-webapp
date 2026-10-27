// The two links a song carries beside its TikTok sound: Song.spotifyTrackId,
// the Spotify track an operator linked on the campaign, and
// Song.instagramSoundId, the Instagram audio the same release is promoted with.
// The statements are idempotent because the same DDL runs from two places: the
// tracked Prisma migration, and /api/admin/migrate-song-links for production,
// which has no usable _prisma_migrations lineage (never `migrate deploy`
// there).
//
// Additive only: two nullable columns on an existing table, one index and one
// foreign key. Unlike a new table (lib/songs/streamSnapshotDdl.ts), a column
// on Song is named by any Prisma query that selects it, so the order of deploy
// and DDL matters here, and the code ships FIRST: every read and write of
// either column goes through lib/songs/songLinks.ts or lib/songs/songSounds.ts,
// which answer "no link" while the columns are missing. Everything else that
// touches Song already selects its fields explicitly, so it never names them
// at all (pinned by __tests__/unit/lib/songLinkColumnsMissing.test.ts against
// the SQL Prisma really sends).
//
// Both columns are added by ONE statement, so a database has both or neither,
// and "the links are ready" is one fact rather than two.

export const SONG_LINK_COLUMNS = ["spotifyTrackId", "instagramSoundId"] as const;

export const SONG_LINK_DDL: string[] = [
  `ALTER TABLE "Song" ADD COLUMN IF NOT EXISTS "spotifyTrackId" TEXT, ADD COLUMN IF NOT EXISTS "instagramSoundId" TEXT`,
  `CREATE INDEX IF NOT EXISTS "Song_instagramSoundId_idx" ON "Song"("instagramSoundId")`,
  /* The same delete rule as Song_soundId_fkey: removing a tracker empties the
     slot rather than refusing the delete or taking the song with it. */
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Song_instagramSoundId_fkey') THEN
    ALTER TABLE "Song" ADD CONSTRAINT "Song_instagramSoundId_fkey"
      FOREIGN KEY ("instagramSoundId") REFERENCES "TikTokSound"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$`,
];

/**
 * A query failed because the song link columns are not there yet.
 *
 * P2022 is Prisma's "column does not exist". Its message cannot be relied on to
 * name the column: Postgres reports a select as `column t0.spotifyTrackId does
 * not exist`, which the pg adapter cannot parse a name out of, so Prisma says
 * "The column `(not available)` does not exist". Every caller wraps a query
 * whose only possibly-missing columns are these two, so the code alone
 * decides; the message test covers the raw-SQL path, where Postgres's own text
 * arrives.
 */
export function isMissingSongLinkColumn(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return code === "P2022" || /(spotifyTrackId|instagramSoundId)\b.*does not exist/i.test(message);
}
