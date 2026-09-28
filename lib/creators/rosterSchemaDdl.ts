// The creator roster tables: CreatorProfileLink, CreatorDetail and
// CreatorListShare. Every statement is idempotent because the same DDL runs
// from two places: the tracked Prisma migration, and
// /api/admin/migrate-creator-roster for production, which has no usable
// _prisma_migrations lineage (never `migrate deploy` there).
//
// Additive only: three new tables and no new column on an existing one, so a
// deploy that lands before this runs leaves every existing query untouched.
// The code that reads them treats a missing table as empty.

export const ROSTER_TABLES = ["CreatorProfileLink", "CreatorDetail", "CreatorListShare"] as const;

function foreignKey(table: string, name: string, column: string, references: string): string {
  return `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
      ALTER TABLE "${table}" ADD CONSTRAINT "${name}"
        FOREIGN KEY ("${column}") REFERENCES ${references} ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`;
}

export const CREATOR_ROSTER_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "CreatorProfileLink" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "handle" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "followersCount" DOUBLE PRECISION,
    "averageViews" DOUBLE PRECISION,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "refreshedAt" TIMESTAMP(3),
    "refreshError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorProfileLink_pkey" PRIMARY KEY ("id")
  )`,
  `ALTER TABLE "CreatorProfileLink" ADD COLUMN IF NOT EXISTS "refreshedAt" TIMESTAMP(3)`,
  `ALTER TABLE "CreatorProfileLink" ADD COLUMN IF NOT EXISTS "refreshError" TEXT`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CreatorProfileLink_orgId_platform_handle_key" ON "CreatorProfileLink"("orgId", "platform", "handle")`,
  `CREATE INDEX IF NOT EXISTS "CreatorProfileLink_creatorId_idx" ON "CreatorProfileLink"("creatorId")`,
  `CREATE INDEX IF NOT EXISTS "CreatorProfileLink_refreshedAt_idx" ON "CreatorProfileLink"("refreshedAt")`,
  foreignKey("CreatorProfileLink", "CreatorProfileLink_creatorId_fkey", "creatorId", `"Creator"("id")`),

  `CREATE TABLE IF NOT EXISTS "CreatorDetail" (
    "creatorId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "country" TEXT,
    "audienceCountry" TEXT,
    "niche" TEXT,
    "source" TEXT,
    "signedUpAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorDetail_pkey" PRIMARY KEY ("creatorId")
  )`,
  `ALTER TABLE "CreatorDetail" ADD COLUMN IF NOT EXISTS "niche" TEXT`,
  `CREATE INDEX IF NOT EXISTS "CreatorDetail_orgId_audienceCountry_idx" ON "CreatorDetail"("orgId", "audienceCountry")`,
  `CREATE INDEX IF NOT EXISTS "CreatorDetail_orgId_country_idx" ON "CreatorDetail"("orgId", "country")`,
  foreignKey("CreatorDetail", "CreatorDetail_creatorId_fkey", "creatorId", `"Creator"("id")`),

  `CREATE TABLE IF NOT EXISTS "CreatorListShare" (
    "listId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorListShare_pkey" PRIMARY KEY ("listId")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CreatorListShare_token_key" ON "CreatorListShare"("token")`,
  `CREATE INDEX IF NOT EXISTS "CreatorListShare_orgId_idx" ON "CreatorListShare"("orgId")`,
  foreignKey("CreatorListShare", "CreatorListShare_listId_fkey", "listId", `"CreatorList"("id")`),
];
