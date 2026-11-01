-- Sprint B: CampaignRules + PostAnnotation. Mirrors lib/campaigns/rulesDdl.ts
-- (pinned by __tests__/unit/lib/campaignRulesSchemaDdl.test.ts).

CREATE TABLE IF NOT EXISTS "CampaignRules" (
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
  );

CREATE INDEX IF NOT EXISTS "CampaignRules_launchAt_idx" ON "CampaignRules"("launchAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CampaignRules_campaignId_fkey') THEN
      ALTER TABLE "CampaignRules" ADD CONSTRAINT "CampaignRules_campaignId_fkey"
        FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "PostAnnotation" (
    "postId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "boostCode" TEXT,
    "boostCodeExpiresAt" TIMESTAMP(3),
    "ruleNotes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "exclusionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PostAnnotation_pkey" PRIMARY KEY ("postId")
  );

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'PostAnnotation_postId_fkey') THEN
      ALTER TABLE "PostAnnotation" ADD CONSTRAINT "PostAnnotation_postId_fkey"
        FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
