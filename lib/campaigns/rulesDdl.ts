// The CampaignRules and PostAnnotation tables (Sprint B: checklist, submission
// rules, launch date and view goal; boost codes, rule notes and exclusion
// reasons). Every statement is idempotent because the same DDL runs from two
// places: the tracked Prisma migration, and /api/admin/migrate-campaign-rules
// for production, which has no usable _prisma_migrations lineage (never
// `migrate deploy` there).
//
// Additive only: two new tables, and no column on Campaign or Post. Every
// reader treats a missing table as "nothing set" (isMissingRulesTable), so the
// order of deploy and DDL does not matter -- the same contract as
// SongStreamSnapshot (lib/songs/streamSnapshotDdl.ts).

export const CAMPAIGN_RULES_TABLE = "CampaignRules";
export const POST_ANNOTATION_TABLE = "PostAnnotation";

export const CAMPAIGN_RULES_COLUMNS = [
  "allowBoostCodes",
  "allowExclusions",
  "campaignId",
  "createdAt",
  "donts",
  "dos",
  "examplePostUrls",
  "launchAt",
  "maxPostsPerAccount",
  "minFollowers",
  "orgId",
  "requiredHashtags",
  "requiredMentions",
  "updatedAt",
  "viewGoal",
];

export const POST_ANNOTATION_COLUMNS = [
  "boostCode",
  "boostCodeExpiresAt",
  "createdAt",
  "exclusionReason",
  "orgId",
  "postId",
  "ruleNotes",
  "updatedAt",
];

export const CAMPAIGN_RULES_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "CampaignRules" (
    "campaignId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dos" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "donts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "examplePostUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "minFollowers" INTEGER,
    "requiredHashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "requiredMentions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxPostsPerAccount" INTEGER,
    "launchAt" TIMESTAMP(3),
    "viewGoal" INTEGER,
    "allowExclusions" BOOLEAN NOT NULL DEFAULT false,
    "allowBoostCodes" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CampaignRules_pkey" PRIMARY KEY ("campaignId")
  )`,
  `CREATE INDEX IF NOT EXISTS "CampaignRules_launchAt_idx" ON "CampaignRules"("launchAt")`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignRules_campaignId_fkey') THEN
      ALTER TABLE "CampaignRules" ADD CONSTRAINT "CampaignRules_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
  `CREATE TABLE IF NOT EXISTS "PostAnnotation" (
    "postId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "boostCode" TEXT,
    "boostCodeExpiresAt" TIMESTAMP(3),
    "ruleNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclusionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PostAnnotation_pkey" PRIMARY KEY ("postId")
  )`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostAnnotation_postId_fkey') THEN
      ALTER TABLE "PostAnnotation" ADD CONSTRAINT "PostAnnotation_postId_fkey"
        FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];

/** True for Prisma's "table does not exist" on either table. */
export function isMissingRulesTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return code === "P2021" || /(CampaignRules|PostAnnotation).*does not exist|relation "(CampaignRules|PostAnnotation)"/i.test(message);
}
