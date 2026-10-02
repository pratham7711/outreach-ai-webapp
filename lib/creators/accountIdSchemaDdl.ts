// CreatorPlatformAccountId: the platform's own id for a creator's account,
// beside the handle (plan §13 A4). YouTube already keeps its channel id on
// Creator.platformUserId; TikTok and Instagram had nothing but the handle, which
// a rename breaks. Every statement is idempotent because the same DDL runs from
// two places: the tracked Prisma migration, and
// /api/admin/migrate-creator-account-ids for production, which has no usable
// _prisma_migrations lineage (never `migrate deploy` there).
//
// Additive only: one new table and no new column on an existing one. The code
// that writes it asks lib/creators/accountIdTables first and skips the write
// when the table is absent, so a deploy that lands before this runs behaves
// exactly as before.

// Index names are spelled out short: Postgres truncates identifiers past 63
// characters, and the default compound name would silently become a different
// one from the name Prisma expects.
export const ACCOUNT_ID_TABLES = ["CreatorPlatformAccountId"] as const;

function foreignKey(table: string, name: string, column: string, references: string): string {
  return `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
      ALTER TABLE "${table}" ADD CONSTRAINT "${name}"
        FOREIGN KEY ("${column}") REFERENCES ${references} ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`;
}

export const CREATOR_ACCOUNT_ID_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "CreatorPlatformAccountId" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platformAccountId" TEXT NOT NULL,
    "secUid" TEXT,
    "handle" TEXT,
    "source" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorPlatformAccountId_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CreatorPlatformAccountId_creator_platform_id_key" ON "CreatorPlatformAccountId"("creatorId", "platform", "platformAccountId")`,
  `CREATE INDEX IF NOT EXISTS "CreatorPlatformAccountId_org_platform_id_idx" ON "CreatorPlatformAccountId"("orgId", "platform", "platformAccountId")`,
  foreignKey("CreatorPlatformAccountId", "CreatorPlatformAccountId_creatorId_fkey", "creatorId", `"Creator"("id")`),
];
