// The two Creator Finder tables. Every statement is idempotent because the same
// DDL runs from two places: the tracked Prisma migration, and
// /api/admin/migrate-creator-finder for production, which has no usable
// _prisma_migrations lineage (never `migrate deploy` there).
//
// Additive only: two new tables and nothing on an existing one. Every route
// treats a missing table as "Creator Finder is not set up yet"
// (isMissingProspectTable), so the order of deploy and DDL does not matter.
// Same contract as SongStreamSnapshot (lib/songs/streamSnapshotDdl.ts).
//
// What is stored is only what the agency typed or chose: the handle, the board
// column, its note and the history of moves. The profile itself -- followers,
// bio, contact routes -- is read live when a card is opened and never written
// here, the same rule as the agency Business Discovery read
// (app/api/creators/[id]/instagram-discovery).
//
// aiTags is the one exception in kind, not in content: the AI's labels for what
// a creator makes ("car edits", "Portuguese"), which part of the profile each
// came from (bio, or a post id), the model, the time and a SHA-256 of the exact
// text it read. The text itself is not kept; the drawer shows the source from
// the live read.

export const PROSPECT_TABLE = "CreatorProspect";
export const PROSPECT_EVENT_TABLE = "CreatorProspectEvent";

export const PROSPECT_COLUMNS = [
  "aiTags",
  "channelId",
  "createdAt",
  "createdById",
  "dismissReason",
  "handle",
  "id",
  "note",
  "orgId",
  "platform",
  "source",
  "status",
  "statusChangedAt",
  "updatedAt",
];

export const PROSPECT_EVENT_COLUMNS = ["at", "fromStatus", "id", "orgId", "prospectId", "toStatus", "userId"];

export const PROSPECT_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "CreatorProspect" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "handle" TEXT NOT NULL,
    "channelId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'FOUND',
    "source" TEXT NOT NULL DEFAULT 'PASTE',
    "note" TEXT,
    "dismissReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusChangedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiTags" JSONB,
    CONSTRAINT "CreatorProspect_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CreatorProspect_orgId_platform_handle_key" ON "CreatorProspect"("orgId", "platform", "handle")`,
  `CREATE INDEX IF NOT EXISTS "CreatorProspect_orgId_status_idx" ON "CreatorProspect"("orgId", "status")`,
  `CREATE TABLE IF NOT EXISTS "CreatorProspectEvent" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "userId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorProspectEvent_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE INDEX IF NOT EXISTS "CreatorProspectEvent_prospectId_at_idx" ON "CreatorProspectEvent"("prospectId", "at")`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorProspectEvent_prospectId_fkey') THEN
    ALTER TABLE "CreatorProspectEvent" ADD CONSTRAINT "CreatorProspectEvent_prospectId_fkey"
      FOREIGN KEY ("prospectId") REFERENCES "CreatorProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$`,
];

/**
 * A query failed because the Creator Finder tables are not there yet. P2021 is
 * Prisma's "table does not exist"; the message test covers the raw-SQL path,
 * where Postgres's own text arrives.
 */
export function isMissingProspectTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return code === "P2021" || /CreatorProspect(Event)?\b.*does not exist/i.test(message);
}
