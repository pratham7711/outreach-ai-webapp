// Schema changes that move ownership of a social connection from the per-org
// Creator row to the global CreatorUser identity.
//
// Why: CreatorSocialAccount.creatorId points at Creator, which is per-org, and
// CreatorUser — what a creator actually logs in as — has no FK to Creator at
// all. The two are joined at request time by a handle-string match plus an
// ownership proof (lib/portal/creatorLink.ts). That means a creator rostered by
// three agencies has three copies of one token, a creator no agency has
// rostered has nowhere to put one, and nothing can own "this person's combined
// followers".
//
// This is the EXPAND half only. Every statement is additive: no NOT NULL, no
// DROP COLUMN, no data written. Nothing here reads the new columns, so it is
// safe to apply before the code that uses them ships — and it must be, because
// deploying the read code first makes /api/portal/insights and
// /api/portal/connections 500 on "column does not exist".
//
// Every statement is idempotent because the same DDL runs from two places: the
// tracked Prisma migration (prisma/migrations/20260909120000_creator_account_identity)
// for anything that runs `migrate deploy`, and
// /api/admin/migrate-account-identity for production, which has no
// _prisma_migrations table and whose DATABASE_URL is a Vercel sensitive
// variable that cannot be read back to a laptop.
//
// Statements are a list, not one blob: Prisma's executeRawUnsafe uses the
// extended protocol, which permits exactly one statement per call.

/**
 * The four columns on CreatorSocialAccount, plus the one on Creator.
 *
 * `creatorUserId` is the new owner. Nullable on purpose and permanently so:
 * rows an agency entered by hand, and rows no identity could be resolved for,
 * legitimately have none. Only a portal OAuth callback guarantees one.
 *
 * `tokenAad` records WHICH AAD sealed this row's tokens — see
 * lib/crypto/tokenContext.ts. Never inferred by trial decryption: AES-GCM
 * cannot tell a wrong AAD from a corrupt ciphertext, so a fallback would hide
 * a backfill that missed rows.
 *
 * `legacyAadOrgId` captures the orgId the existing ciphertext was sealed under,
 * so a row stays decryptable after creatorId stops being the owner. Write-once
 * and transitional — dropping it is what makes the change irreversible, so it
 * belongs to the contract step and not to this one.
 *
 * `origin` is how the row came to exist: "oauth" (portal consent), "manual" (an
 * agency typed it, and accessToken is the literal string "manual-entry"), or
 * "dev" (the dev connect shortcut). Today those are only distinguishable by
 * decrypting the token and string-matching it, which is why
 * /api/portal/connections reports connected: true for a row holding no
 * credential at all.
 *
 * `Creator.creatorUserId` is the roster row's reference to the identity. Not
 * decoration: without it Post -> Creator has no route to the identity's tokens,
 * and the sync cron would need a runtime handle+proof computation inside its
 * loop.
 */
export const IDENTITY_COLUMN_DDL: string[] = [
  `ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "creatorUserId" TEXT`,
  `ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "tokenAad" TEXT`,
  `ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "legacyAadOrgId" TEXT`,
  `ALTER TABLE "CreatorSocialAccount" ADD COLUMN IF NOT EXISTS "origin" TEXT`,
  `ALTER TABLE "Creator" ADD COLUMN IF NOT EXISTS "creatorUserId" TEXT`,
];

/**
 * Indexes and the new unique key.
 *
 * The existing [creatorId, platform, platformUserId] key is deliberately KEPT.
 * Both keys are NULLS DISTINCT by default, so an identity-owned row is
 * validated by the new key only, a legacy row by the old key only, and a
 * transitional row carrying both by both. That is the same NULL-distinctness
 * the previous migration already relied on (see accountSchemaDdl.ts).
 *
 * There is deliberately NO unconditional unique on (platform, platformUserId):
 * two orgs legitimately roster the same person today, which is exactly why
 * lib/oauth/metaDeletion.ts deletes by that pair with deleteMany.
 *
 * The [platform, platformUserId] index is not new work — forgetMetaUser already
 * does a deleteMany on precisely that pair with no index behind it, and that is
 * a Meta data-deletion compliance path.
 *
 * Ordering matters: the columns above must exist before any index that
 * references them, so this list runs second.
 */
export const IDENTITY_INDEX_DDL: string[] = [
  `CREATE INDEX IF NOT EXISTS "CreatorSocialAccount_creatorUserId_idx"
     ON "CreatorSocialAccount" ("creatorUserId")`,
  `CREATE INDEX IF NOT EXISTS "CreatorSocialAccount_platform_platformUserId_idx"
     ON "CreatorSocialAccount" ("platform", "platformUserId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CreatorSocialAccount_creatorUserId_platform_platformUserId_key"
     ON "CreatorSocialAccount" ("creatorUserId", "platform", "platformUserId")`,
  `CREATE INDEX IF NOT EXISTS "Creator_creatorUserId_idx" ON "Creator" ("creatorUserId")`,
];

/**
 * The two foreign keys.
 *
 * Postgres has no ADD CONSTRAINT IF NOT EXISTS, so each is wrapped in the
 * duplicate_object guard already used by lib/creatorcore/parityDdl.ts.
 *
 * NOT VALID first, then a separate VALIDATE: NOT VALID takes no long lock and
 * cannot fail on a partially-backfilled table, and VALIDATE is a no-op if the
 * constraint is already valid, which keeps the whole list re-runnable.
 *
 * ON DELETE SET NULL, not CASCADE. A hard delete of a CreatorUser must not take
 * the tokens with it: destroying the only copy of a credential leaves the OAuth
 * grant live at TikTok, Meta or Google with nothing left that can revoke it.
 * The disconnect route already has this failure mode and it is silent.
 */
export const IDENTITY_FK_DDL: string[] = [
  `DO $$ BEGIN
     ALTER TABLE "CreatorSocialAccount"
       ADD CONSTRAINT "CreatorSocialAccount_creatorUserId_fkey"
       FOREIGN KEY ("creatorUserId") REFERENCES "CreatorUser"("id")
       ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `ALTER TABLE "CreatorSocialAccount" VALIDATE CONSTRAINT "CreatorSocialAccount_creatorUserId_fkey"`,
  `DO $$ BEGIN
     ALTER TABLE "Creator"
       ADD CONSTRAINT "Creator_creatorUserId_fkey"
       FOREIGN KEY ("creatorUserId") REFERENCES "CreatorUser"("id")
       ON DELETE SET NULL ON UPDATE CASCADE NOT VALID;
   EXCEPTION WHEN duplicate_object THEN NULL; END $$`,
  `ALTER TABLE "Creator" VALIDATE CONSTRAINT "Creator_creatorUserId_fkey"`,
];

/** The whole expand step, in the order it must be applied. */
export const IDENTITY_DDL: string[] = [
  ...IDENTITY_COLUMN_DDL,
  ...IDENTITY_INDEX_DDL,
  ...IDENTITY_FK_DDL,
];

/** Columns the route checks for, to report whether the change is in place. */
export const IDENTITY_ACCOUNT_COLUMNS = [
  "creatorUserId",
  "tokenAad",
  "legacyAadOrgId",
  "origin",
] as const;

export const IDENTITY_CREATOR_COLUMNS = ["creatorUserId"] as const;

export const IDENTITY_INDEX_NAMES = [
  "CreatorSocialAccount_creatorUserId_idx",
  "CreatorSocialAccount_platform_platformUserId_idx",
  "CreatorSocialAccount_creatorUserId_platform_platformUserId_key",
] as const;

/**
 * The key the expand step must NOT remove.
 *
 * Legacy org-owned rows carry creatorUserId NULL and are invisible to the new
 * unique key, so this is the only thing still validating them.
 */
export const IDENTITY_RETAINED_KEY =
  "CreatorSocialAccount_creatorId_platform_platformUserId_key";
