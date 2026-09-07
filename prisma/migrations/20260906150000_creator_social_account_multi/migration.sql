-- One creator, several authorised accounts per platform.
--
-- CreatorSocialAccount previously held only a token and a handle; the account's
-- identity and stats lived on Creator, so connecting Instagram overwrote the
-- TikTok identity on the same creator. These nine columns move that identity
-- onto the account row itself.
--
-- The three counters are nullable on purpose: a YouTube channel that hides its
-- subscriber count must read as "would not say", not as a measured zero.
ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "platformUserId" TEXT;
ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT;
ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "bio" TEXT;
ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "profileUrl" TEXT;
ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "followingCount" DOUBLE PRECISION;
ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "mediaCount" INTEGER;
ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "totalLikes" DOUBLE PRECISION;
ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "statsSyncedAt" TIMESTAMP(3);

-- The unique key widens from [creatorId, platform] to
-- [creatorId, platform, platformUserId]. The old key capped every creator at
-- one account per platform, so authorising a second handle overwrote the first.
--
-- Widening never fails on existing data: a table that satisfied the pair cannot
-- hold a duplicate of the triple. Rows written before platformUserId existed
-- carry NULL there, and Postgres treats NULLs as distinct in a unique index.
--
-- Dropped as both a constraint and an index because the same name may exist as
-- either, depending on how it was created in a given environment.
ALTER TABLE "CreatorSocialAccount" DROP CONSTRAINT IF EXISTS "CreatorSocialAccount_creatorId_platform_key";
DROP INDEX IF EXISTS "CreatorSocialAccount_creatorId_platform_key";
CREATE UNIQUE INDEX IF NOT EXISTS "CreatorSocialAccount_creatorId_platform_platformUserId_key"
  ON "CreatorSocialAccount" ("creatorId", "platform", "platformUserId");
