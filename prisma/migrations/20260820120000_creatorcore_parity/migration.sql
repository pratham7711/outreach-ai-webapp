-- CreatorCore parity: Campaign/Post parity columns + lossless Cc* mirror tables.
-- Generated from lib/creatorcore/parityDdl.ts — keep the two in sync.
-- Idempotent so it is safe to apply to an environment that already ran it via
-- the /api/admin/cc-sync route.

DO $$ BEGIN
     CREATE TYPE "PostFetchState" AS ENUM ('LIVE', 'UNAVAILABLE', 'ERROR', 'UNKNOWN');
   EXCEPTION WHEN duplicate_object THEN NULL;
   END $$;

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "ccCampaignId" TEXT;

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "ccFullId" TEXT;

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "ccSlug" TEXT;

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "ccStatusId" TEXT;

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "commissionTotal" DOUBLE PRECISION;

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "creatorRateTotals" DOUBLE PRECISION;

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "lastRefreshAt" TIMESTAMP(3);

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "postRefreshAnchor" TIMESTAMP(3);

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "profitTotal" DOUBLE PRECISION;

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "refreshActive" BOOLEAN;

ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "refreshInterval" DOUBLE PRECISION;

ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "authorProfilePic" TEXT;

ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "autoAdded" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "ccPostId" TEXT;

ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "ccStatusRaw" TEXT;

ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "fetchState" "PostFetchState";

ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "isInstagramStory" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "lastFreshAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "CcCampaign" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ccId" TEXT NOT NULL,
    "ccNumericId" DOUBLE PRECISION,
    "fullId" TEXT,
    "title" TEXT,
    "status" TEXT,
    "thumbnail" TEXT,
    "urlPreview" TEXT,
    "sudoSlug" TEXT,
    "satellite" TEXT,
    "organization" TEXT,
    "currency" TEXT,
    "budget" DOUBLE PRECISION,
    "creatorRateTotals" DOUBLE PRECISION,
    "commissionTotal" DOUBLE PRECISION,
    "profitTotal" DOUBLE PRECISION,
    "refreshInterval" DOUBLE PRECISION,
    "archive" BOOLEAN,
    "refreshActive" BOOLEAN,
    "tempComplete" BOOLEAN,
    "viewMigrateComplete" BOOLEAN,
    "actionColumnAdded" BOOLEAN,
    "defaultDeliverableViewAdded" BOOLEAN,
    "createdBy" TEXT,
    "recentSnapshot" TEXT,
    "nextSnapshotWorkflow" TEXT,
    "createdDate" TIMESTAMP(3),
    "modifiedDate" TIMESTAMP(3),
    "postRefreshAnchor" TIMESTAMP(3),
    "lastRefresh" TIMESTAMP(3),
    "posts" JSONB,
    "activations" JSONB,
    "creatorProfiles" JSONB,
    "metatags" JSONB,
    "modules" JSONB,
    "snapshots" JSONB,
    "activity" JSONB,
    "campaignManagers" JSONB,
    "activationColumns" JSONB,
    "views" JSONB,
    "displayPlatforms" JSONB,
    "raw" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CcCampaign_pkey" PRIMARY KEY ("id")
  );

CREATE TABLE IF NOT EXISTS "CcPost" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ccId" TEXT NOT NULL,
    "campaign" TEXT,
    "organization" TEXT,
    "lastStatistics" TEXT,
    "latestViewsEngagement" DOUBLE PRECISION,
    "platform" TEXT,
    "platformText" TEXT,
    "postUrl" TEXT,
    "status" TEXT,
    "thumbnail" TEXT,
    "username" TEXT,
    "authorProfilePic" TEXT,
    "createdBy" TEXT,
    "createdByUser" TEXT,
    "isInstagramStory" BOOLEAN,
    "autoAdd" BOOLEAN,
    "heicConvert" BOOLEAN,
    "postDate" TIMESTAMP(3),
    "lastFresh" TIMESTAMP(3),
    "createdDate" TIMESTAMP(3),
    "modifiedDate" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CcPost_pkey" PRIMARY KEY ("id")
  );

CREATE TABLE IF NOT EXISTS "CcStatisticPost" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ccId" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CcStatisticPost_pkey" PRIMARY KEY ("id")
  );

CREATE TABLE IF NOT EXISTS "CcRefreshQueue" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ccId" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CcRefreshQueue_pkey" PRIMARY KEY ("id")
  );

CREATE TABLE IF NOT EXISTS "CcRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ccType" TEXT NOT NULL,
    "ccId" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CcRecord_pkey" PRIMARY KEY ("id")
  );

CREATE UNIQUE INDEX IF NOT EXISTS "CcCampaign_ccId_key" ON "CcCampaign"("ccId");

CREATE INDEX IF NOT EXISTS "CcCampaign_orgId_idx" ON "CcCampaign"("orgId");

CREATE UNIQUE INDEX IF NOT EXISTS "CcPost_ccId_key" ON "CcPost"("ccId");

CREATE INDEX IF NOT EXISTS "CcPost_orgId_idx" ON "CcPost"("orgId");

CREATE INDEX IF NOT EXISTS "CcPost_campaign_idx" ON "CcPost"("campaign");

CREATE UNIQUE INDEX IF NOT EXISTS "CcStatisticPost_ccId_key" ON "CcStatisticPost"("ccId");

CREATE INDEX IF NOT EXISTS "CcStatisticPost_orgId_idx" ON "CcStatisticPost"("orgId");

CREATE UNIQUE INDEX IF NOT EXISTS "CcRefreshQueue_ccId_key" ON "CcRefreshQueue"("ccId");

CREATE INDEX IF NOT EXISTS "CcRefreshQueue_orgId_idx" ON "CcRefreshQueue"("orgId");

CREATE INDEX IF NOT EXISTS "CcRecord_orgId_idx" ON "CcRecord"("orgId");

CREATE UNIQUE INDEX IF NOT EXISTS "CcRecord_ccType_ccId_key" ON "CcRecord"("ccType", "ccId");

CREATE UNIQUE INDEX IF NOT EXISTS "Campaign_ccCampaignId_key" ON "Campaign"("ccCampaignId");

CREATE UNIQUE INDEX IF NOT EXISTS "Post_ccPostId_key" ON "Post"("ccPostId");
