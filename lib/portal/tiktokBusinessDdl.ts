// TikTokBusinessConnection: a creator's TikTok account authorised through the
// TikTok API for Business (lib/portal/tiktokBusinessConnection.ts).
//
// Idempotent, because it runs from two places: the tracked Prisma migration,
// and /api/admin/migrate-tiktok-business on production, which has no usable
// _prisma_migrations lineage (never `migrate deploy` there). Additive only:
// one new table. Until it exists the portal offers no TikTok for Business
// connection and says so.

export const TIKTOK_BUSINESS_TABLES = ["TikTokBusinessConnection"] as const;

export const TIKTOK_BUSINESS_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "TikTokBusinessConnection" (
    "creatorUserId" TEXT NOT NULL,
    "openId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "displayName" TEXT,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "scopes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TikTokBusinessConnection_pkey" PRIMARY KEY ("creatorUserId")
  )`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TikTokBusinessConnection_creatorUserId_fkey') THEN
      ALTER TABLE "TikTokBusinessConnection" ADD CONSTRAINT "TikTokBusinessConnection_creatorUserId_fkey"
        FOREIGN KEY ("creatorUserId") REFERENCES "CreatorUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];

/** A query failed because the table is not there yet. */
export function isMissingTikTokBusinessTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return code === "P2021" || TIKTOK_BUSINESS_TABLES.some((t) => message.includes(t));
}
