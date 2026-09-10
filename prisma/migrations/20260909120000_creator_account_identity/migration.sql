-- Move ownership of a social connection from the per-org Creator row to the
-- global CreatorUser identity. EXPAND half only: every statement is additive,
-- no NOT NULL, no DROP, no data written.
--
-- This file is the copy that runs under `migrate deploy`. The copy that runs
-- inside production is lib/platforms/identitySchemaDdl.ts, applied by
-- /api/admin/migrate-account-identity — production has no _prisma_migrations
-- table and `migrate deploy` must never be aimed at it.
--
-- __tests__/unit/lib/identitySchemaDdl.test.ts asserts the two carry the same
-- SQL. A change to one that misses the other leaves the databases different
-- shapes.

ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "creatorUserId" TEXT;

ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "tokenAad" TEXT;

ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "legacyAadOrgId" TEXT;

ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "origin" TEXT;

ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "creatorUserId" TEXT;

CREATE INDEX IF NOT EXISTS "CreatorSocialAccount_creatorUserId_idx"
     ON "CreatorSocialAccount" ("creatorUserId");

CREATE INDEX IF NOT EXISTS "CreatorSocialAccount_platform_platformUserId_idx"
     ON "CreatorSocialAccount" ("platform", "platformUserId");

CREATE UNIQUE INDEX IF NOT EXISTS "CreatorSocialAccount_creatorUserId_platform_platformUserId_key"
     ON "CreatorSocialAccount" ("creatorUserId", "platform", "platformUserId");

CREATE INDEX IF NOT EXISTS "Creator_creatorUserId_idx" ON "Creator" ("creatorUserId");

DO $$ BEGIN
     ALTER TABLE "CreatorSocialAccount"
       ADD CONSTRAINT "CreatorSocialAccount_creatorUserId_fkey"
       FOREIGN KEY ("creatorUserId") REFERENCES "CreatorUser"("id")
       ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "CreatorSocialAccount" VALIDATE CONSTRAINT "CreatorSocialAccount_creatorUserId_fkey";

DO $$ BEGIN
     ALTER TABLE "Creator"
       ADD CONSTRAINT "Creator_creatorUserId_fkey"
       FOREIGN KEY ("creatorUserId") REFERENCES "CreatorUser"("id")
       ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Creator" VALIDATE CONSTRAINT "Creator_creatorUserId_fkey";
