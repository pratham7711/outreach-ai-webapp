CREATE TABLE IF NOT EXISTS "TikTokBusinessConnection" (
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
  );

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TikTokBusinessConnection_creatorUserId_fkey') THEN
      ALTER TABLE "TikTokBusinessConnection" ADD CONSTRAINT "TikTokBusinessConnection_creatorUserId_fkey"
        FOREIGN KEY ("creatorUserId") REFERENCES "CreatorUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$;
