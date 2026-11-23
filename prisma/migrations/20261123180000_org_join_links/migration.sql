CREATE TABLE IF NOT EXISTS "OrgJoinLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "joinedCount" INTEGER NOT NULL DEFAULT 0,
    "lastJoinedAt" TIMESTAMP(3),
    CONSTRAINT "OrgJoinLink_pkey" PRIMARY KEY ("id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "OrgJoinLink_code_key" ON "OrgJoinLink"("code");

CREATE INDEX IF NOT EXISTS "OrgJoinLink_orgId_revokedAt_idx" ON "OrgJoinLink"("orgId", "revokedAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrgJoinLink_orgId_fkey') THEN
      ALTER TABLE "OrgJoinLink" ADD CONSTRAINT "OrgJoinLink_orgId_fkey"
        FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
