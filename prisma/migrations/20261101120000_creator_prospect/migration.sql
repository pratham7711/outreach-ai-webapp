CREATE TABLE IF NOT EXISTS "CreatorProspect" (
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
  );

CREATE UNIQUE INDEX IF NOT EXISTS "CreatorProspect_orgId_platform_handle_key" ON "CreatorProspect"("orgId", "platform", "handle");

CREATE INDEX IF NOT EXISTS "CreatorProspect_orgId_status_idx" ON "CreatorProspect"("orgId", "status");

CREATE TABLE IF NOT EXISTS "CreatorProspectEvent" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "userId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CreatorProspectEvent_pkey" PRIMARY KEY ("id")
  );

CREATE INDEX IF NOT EXISTS "CreatorProspectEvent_prospectId_at_idx" ON "CreatorProspectEvent"("prospectId", "at");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorProspectEvent_prospectId_fkey') THEN
    ALTER TABLE "CreatorProspectEvent" ADD CONSTRAINT "CreatorProspectEvent_prospectId_fkey"
      FOREIGN KEY ("prospectId") REFERENCES "CreatorProspect"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
