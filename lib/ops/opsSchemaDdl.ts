// The tables behind the ops guards (plan §13 C and M): kill switches, cron
// heartbeats, per-source breakers, the daily Sandbox counter and the weekly
// spend meters. Every statement is idempotent; the same list runs from
// /api/admin/migrate-ops-guards on production, where `migrate deploy` must
// never run.
//
// Additive only: new tables, no new column on an existing one (plan F6). Until
// this has run every reader of these tables sees "absent", and absent always
// means today's behaviour: nothing is killed, no breaker is open, no Sandbox is
// refused, and the heartbeat and meter writes are skipped.

export const OPS_TABLES = [
  "OpsKillSwitch",
  "OpsKillSwitchLog",
  "OpsCronHeartbeat",
  "OpsSourceBreaker",
  "OpsSandboxDay",
  "OpsMeterWeek",
] as const;

export const OPS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "OpsKillSwitch" (
    "key" TEXT NOT NULL,
    "off" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "updatedBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpsKillSwitch_pkey" PRIMARY KEY ("key")
  )`,
  `CREATE TABLE IF NOT EXISTS "OpsKillSwitchLog" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "off" BOOLEAN NOT NULL,
    "reason" TEXT,
    "changedBy" TEXT,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpsKillSwitchLog_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "OpsKillSwitchLog_key_changedAt_idx" ON "OpsKillSwitchLog"("key", "changedAt")`,
  `CREATE TABLE IF NOT EXISTS "OpsCronHeartbeat" (
    "job" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastStartedAt" TIMESTAMP(3),
    "lastFinishedAt" TIMESTAMP(3),
    "lastOk" BOOLEAN,
    "lastError" TEXT,
    "durationMs" INTEGER,
    "lastSuccessAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "runs" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "OpsCronHeartbeat_pkey" PRIMARY KEY ("job")
  )`,
  `CREATE TABLE IF NOT EXISTS "OpsSourceBreaker" (
    "key" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'closed',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastSuccessAt" TIMESTAMP(3),
    "lastReason" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpsSourceBreaker_pkey" PRIMARY KEY ("key")
  )`,
  `CREATE TABLE IF NOT EXISTS "OpsSandboxDay" (
    "day" TEXT NOT NULL,
    "caller" TEXT NOT NULL,
    "creations" INTEGER NOT NULL DEFAULT 0,
    "refused" INTEGER NOT NULL DEFAULT 0,
    "closed" INTEGER NOT NULL DEFAULT 0,
    "seconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "vcpuSeconds" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpsSandboxDay_pkey" PRIMARY KEY ("day", "caller")
  )`,
  `CREATE TABLE IF NOT EXISTS "OpsMeterWeek" (
    "id" TEXT NOT NULL,
    "meter" TEXT NOT NULL,
    "weekStart" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "unit" TEXT,
    "costUsd" DOUBLE PRECISION,
    "budgetUsd" DOUBLE PRECISION,
    "ratio" DOUBLE PRECISION,
    "detail" JSONB,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpsMeterWeek_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "OpsMeterWeek_meter_weekStart_idx" ON "OpsMeterWeek"("meter", "weekStart")`,
];
