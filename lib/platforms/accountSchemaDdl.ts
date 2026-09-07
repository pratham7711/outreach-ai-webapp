// Schema changes that let one creator link SEVERAL authorised accounts per
// platform, and that give each of those accounts its own identity and stats.
//
// Every statement is idempotent (IF NOT EXISTS / IF EXISTS) because this same
// DDL runs from two places: the tracked Prisma migration
// (prisma/migrations/20260906150000_creator_social_account_multi) for any
// environment that runs `migrate deploy`, and
// /api/admin/migrate-creator-accounts for production, whose Vercel build
// command is plain `next build` and which has no _prisma_migrations table at
// all — so `migrate deploy` must never be pointed at it.
//
// Statements are a list, not one blob: Prisma's executeRawUnsafe uses the
// extended protocol, which permits exactly one statement per call.

/**
 * The nine identity/stat columns.
 *
 * The three counters are nullable on purpose. A YouTube channel that hides its
 * subscriber count, or a platform that publishes no lifetime like total, must
 * read as "would not say" rather than as a measured zero — the same reason
 * TikTokVideo.exact leaves a missing counter missing.
 */
export const CREATOR_ACCOUNT_COLUMN_DDL: string[] = [
  `ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "platformUserId" TEXT`,
  `ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "avatarUrl" TEXT`,
  `ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "bio" TEXT`,
  `ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "profileUrl" TEXT`,
  `ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "followingCount" DOUBLE PRECISION`,
  `ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "mediaCount" INTEGER`,
  `ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "totalLikes" DOUBLE PRECISION`,
  `ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "statsSyncedAt" TIMESTAMP(3)`,
];

/**
 * The unique key moves from [creatorId, platform] to
 * [creatorId, platform, platformUserId].
 *
 * The old key capped every creator at one account per platform, so authorising
 * a second TikTok handle overwrote the first. Keyed on the platform account
 * instead, a second handle is a second row and re-authorising the first one
 * updates it in place.
 *
 * Ordering matters: the columns above must exist before the index that
 * references `platformUserId` can be created, so this list runs second.
 *
 * Widening a unique key never fails on existing data — a table that satisfied
 * [creatorId, platform] cannot hold a duplicate of the wider triple. Rows that
 * predate `platformUserId` carry NULL there, and Postgres treats NULLs as
 * distinct in a unique index, so they neither block the index nor get
 * deduplicated by it.
 *
 * Both a DROP CONSTRAINT and a DROP INDEX are attempted because the same name
 * may exist as either, depending on whether Prisma created it as a constraint
 * or as a bare index in that environment. Both are guarded with IF EXISTS, so
 * whichever is absent is a no-op.
 */
export const CREATOR_ACCOUNT_INDEX_DDL: string[] = [
  `ALTER TABLE "CreatorSocialAccount" DROP CONSTRAINT IF EXISTS "CreatorSocialAccount_creatorId_platform_key"`,
  `DROP INDEX IF EXISTS "CreatorSocialAccount_creatorId_platform_key"`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CreatorSocialAccount_creatorId_platform_platformUserId_key"
     ON "CreatorSocialAccount" ("creatorId", "platform", "platformUserId")`,
];

/** The whole change, in the order it must be applied. */
export const CREATOR_ACCOUNT_DDL: string[] = [
  ...CREATOR_ACCOUNT_COLUMN_DDL,
  ...CREATOR_ACCOUNT_INDEX_DDL,
];

/** Columns the route checks for, to report whether the change is in place. */
export const CREATOR_ACCOUNT_COLUMNS = [
  "platformUserId",
  "avatarUrl",
  "bio",
  "profileUrl",
  "isVerified",
  "followingCount",
  "mediaCount",
  "totalLikes",
  "statsSyncedAt",
] as const;

export const CREATOR_ACCOUNT_INDEX_NAME =
  "CreatorSocialAccount_creatorId_platform_platformUserId_key";
