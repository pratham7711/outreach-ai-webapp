// The daily API quota counter (plan §13 B): units spent per quota day and per
// bucket, starting with YouTube's videos.batchGetStats, which has its own
// 10,000-unit bucket. Every statement is idempotent; the same list runs from
// /api/admin/migrate-ops-quota on production, where `migrate deploy` must
// never run.
//
// A table of its own, not one more entry in OPS_TABLES: opsTablesReady wants
// every ops table present, so adding one there would switch off the kill
// switches, heartbeats and breakers on any database that has the six but not
// this one. Additive only (plan F6). Until this has run, the counter reads
// "unknown" and the calls it counts are allowed, which is today's behaviour.

export const QUOTA_TABLES = ["OpsQuotaDay"] as const;

export const QUOTA_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "OpsQuotaDay" (
    "day" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "units" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,
    "refused" INTEGER NOT NULL DEFAULT 0,
    "quotaErrors" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OpsQuotaDay_pkey" PRIMARY KEY ("day", "bucket")
  )`,
];
