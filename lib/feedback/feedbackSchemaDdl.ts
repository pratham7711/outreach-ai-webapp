// The Feedback table. Every statement is idempotent because the same DDL runs
// from two places: the tracked Prisma migration, and /api/admin/migrate-feedback
// for production, which has no usable _prisma_migrations lineage (never
// `migrate deploy` there).
//
// Additive only: one new table, no foreign key and no column on an existing
// table, so a deploy that lands before this runs changes nothing else. The
// feedback route asks feedbackTablesReady() first and says it cannot take
// feedback yet while the table is missing.

export const FEEDBACK_TABLES = ["Feedback"] as const;

export const FEEDBACK_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "Feedback" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "surface" TEXT NOT NULL,
    "orgId" TEXT,
    "userId" TEXT,
    "userEmail" TEXT,
    "creatorUserId" TEXT,
    "linkToken" TEXT,
    "message" TEXT,
    "pageUrl" TEXT NOT NULL,
    "pageTitle" TEXT,
    "screenshot" BYTEA,
    "screenshotType" TEXT,
    "screenshotError" TEXT,
    "context" JSONB,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    CONSTRAINT "Feedback_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "Feedback_createdAt_idx" ON "Feedback"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "Feedback_orgId_createdAt_idx" ON "Feedback"("orgId", "createdAt")`,
];
