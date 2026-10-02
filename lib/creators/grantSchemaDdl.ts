// The per-agency grant table: CreatorGrant (plan K4). Every statement is
// idempotent because the same DDL may run more than once:
// /api/admin/migrate-creator-grants applies it on any database, and production
// has no usable _prisma_migrations lineage (never `migrate deploy` there).
//
// Additive only: one new table and no new column on an existing one, so a
// deploy that lands before this runs leaves every existing query untouched.
// Every reader asks lib/creators/grantTables.ts first and, while the table is
// missing, reads connections exactly as it did before grants existed.

export const GRANT_TABLES = ["CreatorGrant"] as const;

export const CREATOR_GRANT_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "CreatorGrant" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "connectionId" TEXT,
    "platformAccountId" TEXT,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "scopesSource" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorGrant_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "CreatorGrant_orgId_creatorId_platform_idx" ON "CreatorGrant"("orgId", "creatorId", "platform")`,
  `CREATE INDEX IF NOT EXISTS "CreatorGrant_connectionId_idx" ON "CreatorGrant"("connectionId")`,
  /* At most one LIVE grant per org and connection. Revoked rows are history and
     may repeat: a connection marked invalid_grant and then reconnected has one
     revoked grant and one live one. Partial, so Prisma's schema cannot express
     it; it exists to make a re-run of the backfill, or a callback racing it,
     unable to double a grant. */
  `CREATE UNIQUE INDEX IF NOT EXISTS "CreatorGrant_live_orgId_connectionId_key" ON "CreatorGrant"("orgId", "connectionId") WHERE "revokedAt" IS NULL`,
  /* CASCADE on the roster row only. A grant names a creator in one org, and a
     roster row hard-deleted takes its consent record with it. There is
     deliberately no FK to CreatorSocialAccount: Disconnect and the platform
     webhooks delete that row, and the grant has to survive it as the record
     that consent was withdrawn. */
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorGrant_creatorId_fkey') THEN
      ALTER TABLE "CreatorGrant" ADD CONSTRAINT "CreatorGrant_creatorId_fkey"
        FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];
