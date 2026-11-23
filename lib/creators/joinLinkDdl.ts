// OrgJoinLink: each agency's one /join/<code> link (lib/creators/joinLink.ts).
//
// Idempotent, because it runs from two places: the tracked Prisma migration,
// and /api/admin/migrate-join-links on production, which has no usable
// _prisma_migrations lineage (never `migrate deploy` there). Additive only:
// one new table. Until it exists the roster shows no join link and /join is a
// 404.

export const JOIN_LINK_TABLES = ["OrgJoinLink"] as const;

export const JOIN_LINK_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "OrgJoinLink" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "joinedCount" INTEGER NOT NULL DEFAULT 0,
    "lastJoinedAt" TIMESTAMP(3),
    CONSTRAINT "OrgJoinLink_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "OrgJoinLink_code_key" ON "OrgJoinLink"("code")`,
  `CREATE INDEX IF NOT EXISTS "OrgJoinLink_orgId_revokedAt_idx" ON "OrgJoinLink"("orgId", "revokedAt")`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'OrgJoinLink_orgId_fkey') THEN
      ALTER TABLE "OrgJoinLink" ADD CONSTRAINT "OrgJoinLink_orgId_fkey"
        FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];

/** A query failed because the join-link table is not there yet. */
export function isMissingJoinLinkTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return code === "P2021" || JOIN_LINK_TABLES.some((t) => message.includes(t));
}
