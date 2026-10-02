-- Generated from lib/creators/accountIdSchemaDdl.ts; idempotent.
CREATE TABLE IF NOT EXISTS "CreatorPlatformAccountId" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platformAccountId" TEXT NOT NULL,
    "secUid" TEXT,
    "handle" TEXT,
    "source" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorPlatformAccountId_pkey" PRIMARY KEY ("id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "CreatorPlatformAccountId_creator_platform_id_key" ON "CreatorPlatformAccountId"("creatorId", "platform", "platformAccountId");

CREATE INDEX IF NOT EXISTS "CreatorPlatformAccountId_org_platform_id_idx" ON "CreatorPlatformAccountId"("orgId", "platform", "platformAccountId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorPlatformAccountId_creatorId_fkey') THEN
      ALTER TABLE "CreatorPlatformAccountId" ADD CONSTRAINT "CreatorPlatformAccountId_creatorId_fkey"
        FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
