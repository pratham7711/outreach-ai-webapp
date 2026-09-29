// The PlatformCredential table, which lets the deployment keep its own
// Instagram Business token alive (lib/platforms/instagramBusinessToken.ts).
// Every statement is idempotent: the same DDL is the tracked migration
// 20260917090000_platform_credentials, and /api/admin/migrate-platform-credentials
// applies it on production, which has no usable _prisma_migrations lineage
// (never `migrate deploy` there).
//
// Additive only: one new table. Until it exists the refresher answers
// "no credential store" and falls back to INSTAGRAM_BUSINESS_TOKEN.

export const PLATFORM_CREDENTIAL_TABLES = ["PlatformCredential"] as const;

export const PLATFORM_CREDENTIAL_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "PlatformCredential" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshedAt" TIMESTAMP(3) NOT NULL,
    "lastAttemptAt" TIMESTAMP(3),
    "lastError" TEXT,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlatformCredential_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "PlatformCredential_provider_key" ON "PlatformCredential"("provider")`,
  `CREATE INDEX IF NOT EXISTS "PlatformCredential_expiresAt_idx" ON "PlatformCredential"("expiresAt")`,
];
