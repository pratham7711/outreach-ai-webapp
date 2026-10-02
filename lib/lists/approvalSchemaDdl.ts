// The list-approval tables: CreatorListDetail and CreatorListItemDetail. Every
// statement is idempotent because the same DDL runs from two places: the
// tracked Prisma migration, and /api/admin/migrate-list-approval for
// production, which has no usable _prisma_migrations lineage (never
// `migrate deploy` there).
//
// Additive only: two new tables and no new column on an existing one, so a
// deploy that lands before this runs leaves every existing list query
// untouched. The code that reads them asks listApprovalTablesReady() first and
// behaves as the plain list did when they are missing.

export const LIST_APPROVAL_TABLES = ["CreatorListDetail", "CreatorListItemDetail"] as const;

function foreignKey(table: string, name: string, column: string, references: string): string {
  return `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
      ALTER TABLE "${table}" ADD CONSTRAINT "${name}"
        FOREIGN KEY ("${column}") REFERENCES ${references} ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`;
}

export const LIST_APPROVAL_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "CreatorListDetail" (
    "listId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "duplicatedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorListDetail_pkey" PRIMARY KEY ("listId")
  )`,
  `CREATE INDEX IF NOT EXISTS "CreatorListDetail_orgId_idx" ON "CreatorListDetail"("orgId")`,
  foreignKey("CreatorListDetail", "CreatorListDetail_listId_fkey", "listId", `"CreatorList"("id")`),

  `CREATE TABLE IF NOT EXISTS "CreatorListItemDetail" (
    "itemId" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "rate" DOUBLE PRECISION,
    "notes" TEXT,
    "sortOrder" INTEGER,
    "decision" TEXT NOT NULL DEFAULT 'PENDING',
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorListItemDetail_pkey" PRIMARY KEY ("itemId")
  )`,
  `CREATE INDEX IF NOT EXISTS "CreatorListItemDetail_listId_idx" ON "CreatorListItemDetail"("listId")`,
  `CREATE INDEX IF NOT EXISTS "CreatorListItemDetail_orgId_idx" ON "CreatorListItemDetail"("orgId")`,
  foreignKey("CreatorListItemDetail", "CreatorListItemDetail_itemId_fkey", "itemId", `"CreatorListItem"("id")`),
];
