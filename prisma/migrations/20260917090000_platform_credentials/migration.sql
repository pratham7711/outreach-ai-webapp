-- A credential the deployment refreshes on its own, replacing a 60-day
-- environment variable nobody can write from inside the application.
CREATE TABLE "PlatformCredential" (
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
);

CREATE UNIQUE INDEX "PlatformCredential_provider_key" ON "PlatformCredential"("provider");
CREATE INDEX "PlatformCredential_expiresAt_idx" ON "PlatformCredential"("expiresAt");
