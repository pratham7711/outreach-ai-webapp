-- Generated from lib/creators/rosterSchemaDdl.ts; idempotent.
CREATE TABLE IF NOT EXISTS "CreatorProfileLink" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "handle" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "followersCount" DOUBLE PRECISION,
    "averageViews" DOUBLE PRECISION,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "refreshedAt" TIMESTAMP(3),
    "refreshError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorProfileLink_pkey" PRIMARY KEY ("id")
  );

ALTER TABLE "CreatorProfileLink" ADD COLUMN IF NOT EXISTS "refreshedAt" TIMESTAMP(3);

ALTER TABLE "CreatorProfileLink" ADD COLUMN IF NOT EXISTS "refreshError" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "CreatorProfileLink_orgId_platform_handle_key" ON "CreatorProfileLink"("orgId", "platform", "handle");

CREATE INDEX IF NOT EXISTS "CreatorProfileLink_creatorId_idx" ON "CreatorProfileLink"("creatorId");

CREATE INDEX IF NOT EXISTS "CreatorProfileLink_refreshedAt_idx" ON "CreatorProfileLink"("refreshedAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorProfileLink_creatorId_fkey') THEN
      ALTER TABLE "CreatorProfileLink" ADD CONSTRAINT "CreatorProfileLink_creatorId_fkey"
        FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "CreatorDetail" (
    "creatorId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "country" TEXT,
    "audienceCountry" TEXT,
    "niche" TEXT,
    "source" TEXT,
    "signedUpAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorDetail_pkey" PRIMARY KEY ("creatorId")
  );

ALTER TABLE "CreatorDetail" ADD COLUMN IF NOT EXISTS "niche" TEXT;

CREATE INDEX IF NOT EXISTS "CreatorDetail_orgId_audienceCountry_idx" ON "CreatorDetail"("orgId", "audienceCountry");

CREATE INDEX IF NOT EXISTS "CreatorDetail_orgId_country_idx" ON "CreatorDetail"("orgId", "country");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorDetail_creatorId_fkey') THEN
      ALTER TABLE "CreatorDetail" ADD CONSTRAINT "CreatorDetail_creatorId_fkey"
        FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "CreatorListShare" (
    "listId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorListShare_pkey" PRIMARY KEY ("listId")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "CreatorListShare_token_key" ON "CreatorListShare"("token");

CREATE INDEX IF NOT EXISTS "CreatorListShare_orgId_idx" ON "CreatorListShare"("orgId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorListShare_listId_fkey') THEN
      ALTER TABLE "CreatorListShare" ADD CONSTRAINT "CreatorListShare_listId_fkey"
        FOREIGN KEY ("listId") REFERENCES "CreatorList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
