// CreatorAudienceSnapshot: who a connected creator's audience is, as the
// platform reported it on one day: the share per country, city, age band and
// gender, for their followers and for the people who engaged with them.
//
// Every statement is idempotent because the same DDL runs from two places: the
// tracked Prisma migration, and /api/admin/migrate-creator-audience for
// production, which has no usable _prisma_migrations lineage (never
// `migrate deploy` there).
//
// Additive only: one new table, no column on an existing one, so the order of
// deploy and DDL does not matter. Until it exists nothing is saved and every
// screen shows no audience.

export const CREATOR_AUDIENCE_TABLES = ["CreatorAudienceSnapshot"] as const;

export const CREATOR_AUDIENCE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "CreatorAudienceSnapshot" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "audience" TEXT NOT NULL,
    "timeframe" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "country" JSONB NOT NULL,
    "city" JSONB NOT NULL,
    "age" JSONB NOT NULL,
    "gender" JSONB NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorAudienceSnapshot_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CreatorAudienceSnapshot_connectionId_orgId_audience_timeframe_day_key" ON "CreatorAudienceSnapshot"("connectionId", "orgId", "audience", "timeframe", "day")`,
  `CREATE INDEX IF NOT EXISTS "CreatorAudienceSnapshot_orgId_creatorId_platform_day_idx" ON "CreatorAudienceSnapshot"("orgId", "creatorId", "platform", "day")`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorAudienceSnapshot_creatorId_fkey') THEN
      ALTER TABLE "CreatorAudienceSnapshot" ADD CONSTRAINT "CreatorAudienceSnapshot_creatorId_fkey"
        FOREIGN KEY ("creatorId") REFERENCES "Creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
  `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorAudienceSnapshot_connectionId_fkey') THEN
      ALTER TABLE "CreatorAudienceSnapshot" ADD CONSTRAINT "CreatorAudienceSnapshot_connectionId_fkey"
        FOREIGN KEY ("connectionId") REFERENCES "CreatorSocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`,
];

/** A query failed because the audience table is not there yet. */
export function isMissingCreatorAudienceTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return code === "P2021" || CREATOR_AUDIENCE_TABLES.some((t) => message.includes(t));
}
