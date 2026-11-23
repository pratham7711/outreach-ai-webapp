CREATE TABLE IF NOT EXISTS "CreatorAudienceSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "audience" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "country" JSONB NOT NULL,
    "city" JSONB NOT NULL,
    "age" JSONB NOT NULL,
    "gender" JSONB NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorAudienceSnapshot_pkey" PRIMARY KEY ("id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "CreatorAudienceSnapshot_connectionId_orgId_audience_timeframe_day_key" ON "CreatorAudienceSnapshot"("connectionId", "orgId", "audience", "timeframe", "day");

CREATE INDEX IF NOT EXISTS "CreatorAudienceSnapshot_orgId_creatorId_platform_day_idx" ON "CreatorAudienceSnapshot"("orgId", "creatorId", "platform", "day");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorAudienceSnapshot_creatorId_fkey') THEN
      ALTER TABLE "CreatorAudienceSnapshot" ADD CONSTRAINT "CreatorAudienceSnapshot_creatorId_fkey"
        FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorAudienceSnapshot_connectionId_fkey') THEN
      ALTER TABLE "CreatorAudienceSnapshot" ADD CONSTRAINT "CreatorAudienceSnapshot_connectionId_fkey"
        FOREIGN KEY ("connectionId") REFERENCES "CreatorSocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
