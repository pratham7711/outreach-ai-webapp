-- Generated from lib/feedback/feedbackSchemaDdl.ts; idempotent.
CREATE TABLE IF NOT EXISTS "Feedback" (
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
  );

CREATE INDEX IF NOT EXISTS "Feedback_createdAt_idx" ON "Feedback"("createdAt");

CREATE INDEX IF NOT EXISTS "Feedback_orgId_createdAt_idx" ON "Feedback"("orgId", "createdAt");
