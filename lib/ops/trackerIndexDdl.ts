// Three indexes the tracker tables were missing. Every statement is idempotent
// because the same DDL runs from two places: the tracked Prisma migration, and
// /api/admin/migrate-tracker-indexes for production, which has no usable
// _prisma_migrations lineage (never `migrate deploy` there).
//
// Each was chosen from a measurement on production (2026-10-03, read-only),
// not from a list of columns that are filtered on:
//
//   SoundTrackerSnapshot (soundId, recordedAt) -- the table had only its
//     primary key. pg_stat_user_tables showed 3,362 sequential scans and zero
//     index scans: the campaign report's "newest reading for this sound" and
//     the sound chart's "last 61 readings" both read the whole table once per
//     sound, so the cost grows as sounds x readings.
//   CreatorTrackerSnapshot (recordedAt) -- the hourly canary asks for "the
//     last day of readings" and got a sequential scan of every reading ever
//     taken. A workspace of 10k creators adds that many rows a day.
//   TikTokSound (orgId) -- the tenant key. Every trackers page and the sound
//     sweep filter on it, and nothing indexed it.
//
// Two that were considered and left out, because the numbers did not support
// them: Post (platform, lastSyncedAt) for the post sweep's candidate query
// (23ms over 15,165 TikTok trackers, a top-N sort in memory), and Creator
// (trackerLastAttemptAt) for the creator sweep (132ms, almost all of it cold
// storage reads after the compute woke, which no index removes).
//
// Plain CREATE INDEX, not CONCURRENTLY: the largest of these tables held
// 10,255 rows, so the build's write lock lasts milliseconds, and CONCURRENTLY
// cannot run inside the transaction a Prisma migration may wrap it in.
//
// The names are Prisma's own defaults, so schema.prisma's @@index lines and
// these agree without a `map:`.
export const TRACKER_INDEXES = [
  "SoundTrackerSnapshot_soundId_recordedAt_idx",
  "CreatorTrackerSnapshot_recordedAt_idx",
  "TikTokSound_orgId_idx",
] as const;

export const TRACKER_INDEX_DDL: string[] = [
  `CREATE INDEX IF NOT EXISTS "SoundTrackerSnapshot_soundId_recordedAt_idx" ON "SoundTrackerSnapshot"("soundId", "recordedAt")`,
  `CREATE INDEX IF NOT EXISTS "CreatorTrackerSnapshot_recordedAt_idx" ON "CreatorTrackerSnapshot"("recordedAt")`,
  `CREATE INDEX IF NOT EXISTS "TikTokSound_orgId_idx" ON "TikTokSound"("orgId")`,
];
