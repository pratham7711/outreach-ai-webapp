// The CampaignThumbnail table. Every statement is idempotent because the same DDL
// runs from two places: the tracked Prisma migration, and
// /api/admin/migrate-campaign-thumbnails for production, which has no usable
// _prisma_migrations lineage (never `migrate deploy` there).
//
// Additive only: a new table nothing else depends on. The code that reads it
// treats a missing table as "no stored picture", so the order of deploy and
// DDL does not matter -- the contract PostThumbnail
// (lib/posts/thumbnailSchemaDdl.ts) and CreatorAvatar already follow.

export const CAMPAIGN_THUMBNAIL_TABLE = "CampaignThumbnail";

export const CAMPAIGN_THUMBNAIL_COLUMNS = ["campaignId", "data", "failedAt", "failure", "fetchedAt", "orgId", "sourceUrl"];

export const CAMPAIGN_THUMBNAIL_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "CampaignThumbnail" (
    "campaignId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "data" BYTEA,
    "sourceUrl" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failure" TEXT,
    CONSTRAINT "CampaignThumbnail_pkey" PRIMARY KEY ("campaignId")
  )`,
  `CREATE INDEX IF NOT EXISTS "CampaignThumbnail_orgId_idx" ON "CampaignThumbnail"("orgId")`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignThumbnail_campaignId_fkey') THEN
      ALTER TABLE "CampaignThumbnail" ADD CONSTRAINT "CampaignThumbnail_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];
