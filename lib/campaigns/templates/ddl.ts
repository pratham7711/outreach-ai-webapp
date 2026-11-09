// The CampaignTemplate table: a campaign's setup saved to start new campaigns
// from. Every statement is idempotent because the same DDL runs from two
// places: the tracked Prisma migration, and /api/admin/migrate-campaign-templates
// for production, which has no usable _prisma_migrations lineage (never
// `migrate deploy` there).
//
// Additive only: one new table with its index and its key to Organization, and
// no column on any existing table. Every reader treats a missing table as "no
// templates" (isMissingTemplatesTable), so the order of deploy and DDL does not
// matter -- the same contract as CampaignRules (lib/campaigns/rulesDdl.ts).
// Copying a past campaign's setup needs no table at all and works before it.

export const CAMPAIGN_TEMPLATE_TABLE = "CampaignTemplate";

export const CAMPAIGN_TEMPLATE_COLUMNS = [
  "createdAt",
  "createdById",
  "deletedAt",
  "description",
  "id",
  "name",
  "orgId",
  "payload",
  "updatedAt",
];

export const CAMPAIGN_TEMPLATE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "CampaignTemplate" (
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
  )`,
  `CREATE INDEX IF NOT EXISTS "CampaignTemplate_orgId_deletedAt_idx" ON "CampaignTemplate"("orgId", "deletedAt")`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignTemplate_orgId_fkey') THEN
      ALTER TABLE "CampaignTemplate" ADD CONSTRAINT "CampaignTemplate_orgId_fkey"
        FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];

/** True for Prisma's "table does not exist" on CampaignTemplate, and no other table. */
export function isMissingTemplatesTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : "";
  if (code === "P2021") return message === "" || /CampaignTemplate/.test(message);
  return /CampaignTemplate.*does not exist|relation "CampaignTemplate"/i.test(message);
}
