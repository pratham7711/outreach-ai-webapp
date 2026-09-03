// Schema changes that give our Campaign/Post the CreatorCore parity fields, plus
// the lossless Cc* mirror tables.
//
// Every statement is idempotent (IF NOT EXISTS / duplicate_object guard) because
// this same DDL runs from two places: the tracked Prisma migration
// (prisma/migrations/20260820120000_creatorcore_parity) for any environment that
// runs `migrate deploy`, and the /api/admin/cc-sync route for production, whose
// Vercel build command is plain `next build` and so never runs migrations.
//
// Statements are a list, not one blob: Prisma's executeRawUnsafe uses the
// extended protocol, which permits exactly one statement per call.

export const PARITY_DDL: string[] = [
  `DO $$ BEGIN
     CREATE TYPE "PostFetchState" AS ENUM ('LIVE', 'UNAVAILABLE', 'ERROR', 'UNKNOWN');
   EXCEPTION WHEN duplicate_object THEN NULL;
   END $$`,

  `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "archived" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "ccCampaignId" TEXT`,
  `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "ccFullId" TEXT`,
  `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "ccSlug" TEXT`,
  `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "ccStatusId" TEXT`,
  `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "commissionTotal" DOUBLE PRECISION`,
  `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "creatorRateTotals" DOUBLE PRECISION`,
  `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "lastRefreshAt" TIMESTAMP(3)`,
  `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "postRefreshAnchor" TIMESTAMP(3)`,
  `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "profitTotal" DOUBLE PRECISION`,
  `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "refreshActive" BOOLEAN`,
  `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "refreshInterval" DOUBLE PRECISION`,

  `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "authorProfilePic" TEXT`,
  `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "autoAdded" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "ccPostId" TEXT`,
  `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "ccStatusRaw" TEXT`,
  `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "fetchState" "PostFetchState"`,
  `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "isInstagramStory" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "lastFreshAt" TIMESTAMP(3)`,

  `CREATE TABLE IF NOT EXISTS "CcCampaign" (
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
  )`,

  `CREATE TABLE IF NOT EXISTS "CcPost" (
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
  )`,

  `CREATE TABLE IF NOT EXISTS "CcStatisticPost" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ccId" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CcStatisticPost_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "CcRefreshQueue" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ccId" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CcRefreshQueue_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "CcRecord" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "ccType" TEXT NOT NULL,
    "ccId" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CcRecord_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE UNIQUE INDEX IF NOT EXISTS "CcCampaign_ccId_key" ON "CcCampaign"("ccId")`,
  `CREATE INDEX IF NOT EXISTS "CcCampaign_orgId_idx" ON "CcCampaign"("orgId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CcPost_ccId_key" ON "CcPost"("ccId")`,
  `CREATE INDEX IF NOT EXISTS "CcPost_orgId_idx" ON "CcPost"("orgId")`,
  `CREATE INDEX IF NOT EXISTS "CcPost_campaign_idx" ON "CcPost"("campaign")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CcStatisticPost_ccId_key" ON "CcStatisticPost"("ccId")`,
  `CREATE INDEX IF NOT EXISTS "CcStatisticPost_orgId_idx" ON "CcStatisticPost"("orgId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CcRefreshQueue_ccId_key" ON "CcRefreshQueue"("ccId")`,
  `CREATE INDEX IF NOT EXISTS "CcRefreshQueue_orgId_idx" ON "CcRefreshQueue"("orgId")`,
  `CREATE INDEX IF NOT EXISTS "CcRecord_orgId_idx" ON "CcRecord"("orgId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CcRecord_ccType_ccId_key" ON "CcRecord"("ccType", "ccId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Campaign_ccCampaignId_key" ON "Campaign"("ccCampaignId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "Post_ccPostId_key" ON "Post"("ccPostId")`,
];

// Drift repair, unrelated to CreatorCore.
//
// Production was provisioned with `prisma db push` and has no _prisma_migrations
// table, so migrations added since never reached it. Comparing every model in
// schema.prisma against production's information_schema turned up exactly one
// gap: the four Activation draft columns from
// prisma/migrations/20260812041000_add_activation_draft_fields.
//
// That gap broke GET /api/campaigns/[id] for EVERY campaign — the query joins
// `activations`, so Prisma selected columns the database did not have and failed
// the whole request with P2022 ColumnNotFound. Re-diff with the cc-sync
// `columns` action if this list ever needs revisiting.
export const DRIFT_REPAIR_DDL: string[] = [
  `ALTER TABLE "Activation" ADD COLUMN IF NOT EXISTS "draftUrl" TEXT`,
  `ALTER TABLE "Activation" ADD COLUMN IF NOT EXISTS "draftCaption" TEXT`,
  `ALTER TABLE "Activation" ADD COLUMN IF NOT EXISTS "draftMediaType" "MediaType"`,
  `ALTER TABLE "Activation" ADD COLUMN IF NOT EXISTS "draftSubmittedAt" TIMESTAMP(3)`,
];

// Songs, campaign phases and metered sync slots.
//
// These models arrived with the trackers branch, which carries them as the
// tracked migration prisma/migrations/20260814000000_song_phase_and_platforms
// plus schema-only additions that never got a migration at all (SyncSlot,
// Organization.syncSlotPoolSize). Production runs neither: its build command is
// plain `next build`, so no migration has ever executed there.
//
// The statements below are that whole set restated idempotently, derived from
// `prisma migrate diff --from-empty --to-schema` so the column types, defaults
// and referential actions are Prisma's own output rather than hand-typed. The
// scope is exactly `git diff feat/creatorcore-extract..HEAD -- prisma/schema.prisma`,
// which is the only part of the schema that had not already been diffed against
// production when DRIFT_REPAIR_DDL above was written.
//
// Additive only — no DROP, no type change, no data touched. Anything already
// present is left exactly as it is, so this is safe to re-run and safe to run
// against a database whose rows were not created by us.
export const SONG_PHASE_SLOT_DDL: string[] = [
  `DO $$ BEGIN
     CREATE TYPE "SyncSlotState" AS ENUM ('POOL', 'ASSIGNED', 'WARM', 'COOLING', 'RELEASED', 'PINNED');
   EXCEPTION WHEN duplicate_object THEN NULL;
   END $$`,

  `CREATE TABLE IF NOT EXISTS "Song" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "artist" TEXT NOT NULL,
    "isrc" TEXT,
    "releaseDate" TIMESTAMP(3),
    "coverUrl" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Song_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "CampaignPhase" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "targetPosts" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignPhase_pkey" PRIMARY KEY ("id")
  )`,

  `CREATE TABLE IF NOT EXISTS "SyncSlot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "campaignId" TEXT,
    "postId" TEXT,
    "state" "SyncSlotState" NOT NULL DEFAULT 'POOL',
    "assignedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "pinnedAt" TIMESTAMP(3),
    "hotUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncSlot_pkey" PRIMARY KEY ("id")
  )`,

  `ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "syncSlotPoolSize" INTEGER NOT NULL DEFAULT 100`,
  `ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "songId" TEXT`,
  `ALTER TABLE "Post" ADD COLUMN IF NOT EXISTS "phaseId" TEXT`,

  `CREATE INDEX IF NOT EXISTS "Song_orgId_idx" ON "Song"("orgId")`,
  `CREATE INDEX IF NOT EXISTS "Song_orgId_deletedAt_idx" ON "Song"("orgId", "deletedAt")`,
  `CREATE INDEX IF NOT EXISTS "CampaignPhase_campaignId_idx" ON "CampaignPhase"("campaignId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CampaignPhase_campaignId_sequence_key" ON "CampaignPhase"("campaignId", "sequence")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "SyncSlot_postId_key" ON "SyncSlot"("postId")`,
  `CREATE INDEX IF NOT EXISTS "SyncSlot_orgId_state_idx" ON "SyncSlot"("orgId", "state")`,
  `CREATE INDEX IF NOT EXISTS "SyncSlot_campaignId_idx" ON "SyncSlot"("campaignId")`,
  `CREATE INDEX IF NOT EXISTS "Post_phaseId_idx" ON "Post"("phaseId")`,

  // Creator watchlist for the Trackers page's Creators sub-tab. Nullable, so an
  // existing row is untracked until someone tracks it, and no backfill is needed.
  `ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "trackedSince" TIMESTAMP(3)`,
  `CREATE INDEX IF NOT EXISTS "Creator_orgId_trackedSince_idx" ON "Creator"("orgId", "trackedSince")`,

  // The TikTok sound a release is promoted with, so a campaign report can show
  // the audio card CreatorCore's does. It hangs off Song, not Campaign: the usage
  // curve belongs to the audio, and every campaign pushing that release reads the
  // same tracker. Nullable, so songs without a tracked sound are unaffected.
  `ALTER TABLE "Song" ADD COLUMN IF NOT EXISTS "soundId" TEXT`,
  `CREATE INDEX IF NOT EXISTS "Song_soundId_idx" ON "Song"("soundId")`,

  // Which platform a tracked sound belongs to. CreatorCore's audio trackers are
  // tiktok + instagram (73 and 20 of 93, measured 2026-09-03) and it has no
  // YouTube one, so those are the only two values reachable. Reuses the existing
  // "Platform" enum type deliberately: a new type would need CREATE TYPE, which
  // has no IF NOT EXISTS and would break this script's re-runnability. Every
  // pre-existing row is TikTok, which is exactly what the default backfills.
  `ALTER TABLE "TikTokSound" ADD COLUMN IF NOT EXISTS "platform" "Platform" NOT NULL DEFAULT 'TIKTOK'`,

  // Postgres has no ADD CONSTRAINT IF NOT EXISTS. These are not cosmetic: the
  // referential actions below are where `onDelete: SetNull` and `Cascade` in
  // schema.prisma actually live, so without them deleting a campaign fails or
  // silently orphans its slots.
  ...[
    [`Song`, `Song_orgId_fkey`, `FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE`],
    [`CampaignPhase`, `CampaignPhase_campaignId_fkey`, `FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
    [`Campaign`, `Campaign_songId_fkey`, `FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
    [`SyncSlot`, `SyncSlot_orgId_fkey`, `FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE`],
    [`SyncSlot`, `SyncSlot_campaignId_fkey`, `FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
    [`SyncSlot`, `SyncSlot_postId_fkey`, `FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
    [`Post`, `Post_phaseId_fkey`, `FOREIGN KEY ("phaseId") REFERENCES "CampaignPhase"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
    [`Song`, `Song_soundId_fkey`, `FOREIGN KEY ("soundId") REFERENCES "TikTokSound"("id") ON DELETE SET NULL ON UPDATE CASCADE`],
  ].map(
    ([table, name, clause]) => `DO $$ BEGIN
     ALTER TABLE "${table}" ADD CONSTRAINT "${name}" ${clause};
   EXCEPTION WHEN duplicate_object THEN NULL;
   END $$`
  ),
];
