// The SongSoundLink table: a song's sound on a platform without its own column
// on Song (YouTube Shorts audio). Idempotent, because it runs from two places:
// the tracked Prisma migration, and /api/admin/migrate-song-sound-links for
// production, which never runs `migrate deploy`.
//
// A new table, so the order of deploy and DDL does not matter for anything
// that already exists: only the queries in lib/songs/songSoundLinks.ts name it,
// and they read a missing table as "no link".

export const SONG_SOUND_LINK_TABLE = "SongSoundLink";

export const SONG_SOUND_LINK_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "SongSoundLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "songId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "soundId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SongSoundLink_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "SongSoundLink_orgId_idx" ON "SongSoundLink"("orgId")`,
  `CREATE INDEX IF NOT EXISTS "SongSoundLink_soundId_idx" ON "SongSoundLink"("soundId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SongSoundLink_songId_platform_key" ON "SongSoundLink"("songId", "platform")`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SongSoundLink_songId_fkey') THEN
    ALTER TABLE "SongSoundLink" ADD CONSTRAINT "SongSoundLink_songId_fkey"
      FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SongSoundLink_soundId_fkey') THEN
    ALTER TABLE "SongSoundLink" ADD CONSTRAINT "SongSoundLink_soundId_fkey"
      FOREIGN KEY ("soundId") REFERENCES "TikTokSound"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$`,
];

/** P2021 is Prisma's "table does not exist"; the message test covers raw SQL. */
export function isMissingSongSoundLinkTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return code === "P2021" || /SongSoundLink.*does not exist|relation "SongSoundLink"/i.test(message);
}
