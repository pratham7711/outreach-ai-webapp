CREATE TABLE IF NOT EXISTS "CreatorConnectionHealth" (
    "accountId" TEXT NOT NULL,
    "tokenExpiresAt" TIMESTAMP(3),
    "dataAccessExpiresAt" TIMESTAMP(3),
    "lapsesAt" TIMESTAMP(3),
    "checkedAt" TIMESTAMP(3),
    "pageId" TEXT,
    "pageAccessToken" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorConnectionHealth_pkey" PRIMARY KEY ("accountId")
  );

CREATE INDEX IF NOT EXISTS "CreatorConnectionHealth_lapsesAt_idx" ON "CreatorConnectionHealth"("lapsesAt");

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'CreatorConnectionHealth_accountId_fkey') THEN
      ALTER TABLE "CreatorConnectionHealth" ADD CONSTRAINT "CreatorConnectionHealth_accountId_fkey"
        FOREIGN KEY ("accountId") REFERENCES "CreatorSocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
