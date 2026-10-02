-- Generated from lib/lists/approvalSchemaDdl.ts; idempotent.
CREATE TABLE IF NOT EXISTS "CreatorListDetail" (
    "listId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "isFavorite" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),
    "duplicatedFromId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorListDetail_pkey" PRIMARY KEY ("listId")
  );

CREATE INDEX IF NOT EXISTS "CreatorListDetail_orgId_idx" ON "CreatorListDetail"("orgId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorListDetail_listId_fkey') THEN
      ALTER TABLE "CreatorListDetail" ADD CONSTRAINT "CreatorListDetail_listId_fkey"
        FOREIGN KEY ("listId") REFERENCES "CreatorList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;

CREATE TABLE IF NOT EXISTS "CreatorListItemDetail" (
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
  );

CREATE INDEX IF NOT EXISTS "CreatorListItemDetail_listId_idx" ON "CreatorListItemDetail"("listId");

CREATE INDEX IF NOT EXISTS "CreatorListItemDetail_orgId_idx" ON "CreatorListItemDetail"("orgId");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorListItemDetail_itemId_fkey') THEN
      ALTER TABLE "CreatorListItemDetail" ADD CONSTRAINT "CreatorListItemDetail_itemId_fkey"
        FOREIGN KEY ("itemId") REFERENCES "CreatorListItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
