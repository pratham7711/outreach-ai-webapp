-- CampaignTemplate: a campaign's setup saved to start new campaigns from.
-- Mirrors lib/campaigns/templates/ddl.ts (pinned by
-- __tests__/unit/lib/campaignTemplatesDdl.test.ts).

CREATE TABLE IF NOT EXISTS "CampaignTemplate" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "payload" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "CampaignTemplate_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX IF NOT EXISTS "CampaignTemplate_orgId_deletedAt_idx" ON "CampaignTemplate"("orgId", "deletedAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignTemplate_orgId_fkey') THEN
      ALTER TABLE "CampaignTemplate" ADD CONSTRAINT "CampaignTemplate_orgId_fkey"
        FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
