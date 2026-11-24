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

DO $$ BEGIN
    IF to_regclass('public."CreatorEmailVerification"') IS NULL THEN
      CREATE TABLE "CreatorEmailVerification" (
    "creatorUserId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorEmailVerification_pkey" PRIMARY KEY ("creatorUserId")
  );
      INSERT INTO "CreatorEmailVerification" ("creatorUserId") SELECT "id" FROM "CreatorUser";
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "CreatorEmailVerification" (
    "creatorUserId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorEmailVerification_pkey" PRIMARY KEY ("creatorUserId")
  );

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorEmailVerification_creatorUserId_fkey') THEN
      ALTER TABLE "CreatorEmailVerification" ADD CONSTRAINT "CreatorEmailVerification_creatorUserId_fkey"
        FOREIGN KEY ("creatorUserId") REFERENCES "CreatorUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "CreatorJoinRecord" (
    "creatorId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "linkId" TEXT,
    "creatorUserId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorJoinRecord_pkey" PRIMARY KEY ("creatorId")
  );

CREATE INDEX IF NOT EXISTS "CreatorJoinRecord_orgId_idx" ON "CreatorJoinRecord"("orgId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorJoinRecord_creatorId_fkey') THEN
      ALTER TABLE "CreatorJoinRecord" ADD CONSTRAINT "CreatorJoinRecord_creatorId_fkey"
        FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
