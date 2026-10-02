// The tables behind the tracker reader's switch (plan T5): which reader is
// live, how each exit is doing, which exit read each snapshot, and the
// readings the validation gate held back. Every statement is idempotent; the
// same list runs from /api/admin/migrate-tracker-sources on production, where
// `migrate deploy` must never run.
//
// Additive only: new tables, no new column on an existing one. Until this has
// run, every reader of these tables sees "absent" and the tracker stays on the
// legacy sweep, exactly as it is today (plan F6).

export const TRACKER_SOURCE_TABLES = [
  "TrackerSourceSwitch",
  "TrackerSourceSwitchLog",
  "TrackerSourceHealth",
  "TrackerSnapshotSource",
  "TrackerReadingQuarantine",
] as const;

export const TRACKER_SOURCE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "TrackerSourceSwitch" (
    "id" TEXT NOT NULL,
    "position" TEXT NOT NULL DEFAULT 'legacy',
    "scopeOrgIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "percent" INTEGER NOT NULL DEFAULT 100,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedBy" TEXT,
    "note" TEXT,
    CONSTRAINT "TrackerSourceSwitch_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "TrackerSourceSwitchLog" (
    "id" TEXT NOT NULL,
    "switchId" TEXT NOT NULL,
    "fromPosition" TEXT,
    "toPosition" TEXT NOT NULL,
    "scopeOrgIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "percent" INTEGER NOT NULL DEFAULT 100,
    "changedBy" TEXT,
    "note" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrackerSourceSwitchLog_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "TrackerSourceSwitchLog_switchId_changedAt_idx" ON "TrackerSourceSwitchLog"("switchId", "changedAt")`,
  `CREATE TABLE IF NOT EXISTS "TrackerSourceHealth" (
    "id" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3) NOT NULL,
    "reads" INTEGER NOT NULL DEFAULT 0,
    "proper" INTEGER NOT NULL DEFAULT 0,
    "walls" INTEGER NOT NULL DEFAULT 0,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "medianMs" INTEGER,
    "ok" BOOLEAN NOT NULL,
    "detail" JSONB,
    CONSTRAINT "TrackerSourceHealth_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "TrackerSourceHealth_plan_kind_startedAt_idx" ON "TrackerSourceHealth"("plan", "kind", "startedAt")`,
  `CREATE TABLE IF NOT EXISTS "TrackerSnapshotSource" (
    "snapshotId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "plan" TEXT NOT NULL,
    "exitId" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TrackerSnapshotSource_pkey" PRIMARY KEY ("snapshotId")
  )`,
  `CREATE INDEX IF NOT EXISTS "TrackerSnapshotSource_creatorId_recordedAt_idx" ON "TrackerSnapshotSource"("creatorId", "recordedAt")`,
  `CREATE TABLE IF NOT EXISTS "TrackerReadingQuarantine" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "followersCount" DOUBLE PRECISION,
    "postsCount" INTEGER,
    "previousFollowers" DOUBLE PRECISION,
    "verdict" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "via" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    CONSTRAINT "TrackerReadingQuarantine_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "TrackerReadingQuarantine_creatorId_recordedAt_idx" ON "TrackerReadingQuarantine"("creatorId", "recordedAt")`,
  `CREATE INDEX IF NOT EXISTS "TrackerReadingQuarantine_orgId_recordedAt_idx" ON "TrackerReadingQuarantine"("orgId", "recordedAt")`,
];
