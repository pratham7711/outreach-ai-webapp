CREATE TABLE IF NOT EXISTS "CampaignThumbnail" (
    "campaignId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "data" BYTEA,
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failure" TEXT,
    CONSTRAINT "CampaignThumbnail_pkey" PRIMARY KEY ("campaignId")
  );

CREATE INDEX IF NOT EXISTS "CampaignThumbnail_orgId_idx" ON "CampaignThumbnail"("orgId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignThumbnail_campaignId_fkey') THEN
      ALTER TABLE "CampaignThumbnail" ADD CONSTRAINT "CampaignThumbnail_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
