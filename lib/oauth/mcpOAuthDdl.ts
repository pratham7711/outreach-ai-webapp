// The three MCP OAuth tables. Idempotent, because it runs from two places: the
// tracked Prisma migration, and /api/admin/migrate-mcp-oauth for production,
// which never runs `migrate deploy`.
//
// New tables only, so deploy and DDL can land in either order: nothing that
// exists today reads them, and until they exist the OAuth endpoints answer
// "temporarily unavailable" while API keys and sessions keep working.

export const MCP_OAUTH_TABLES = ["McpOAuthClient", "McpOAuthCode", "McpOAuthToken"] as const;

export const MCP_OAUTH_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "McpOAuthClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecretHash" TEXT,
    "name" TEXT,
    "clientUri" TEXT,
    "logoUri" TEXT,
    "redirectUris" TEXT[],
    "tokenEndpointAuthMethod" TEXT NOT NULL DEFAULT 'none',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "McpOAuthClient_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "McpOAuthCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "McpOAuthCode_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE TABLE IF NOT EXISTS "McpOAuthToken" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "resource" TEXT,
    "accessTokenHash" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenHash" TEXT,
    "refreshExpiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "McpOAuthToken_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "McpOAuthClient_clientId_key" ON "McpOAuthClient"("clientId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "McpOAuthCode_codeHash_key" ON "McpOAuthCode"("codeHash")`,
  `CREATE INDEX IF NOT EXISTS "McpOAuthCode_expiresAt_idx" ON "McpOAuthCode"("expiresAt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "McpOAuthToken_accessTokenHash_key" ON "McpOAuthToken"("accessTokenHash")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "McpOAuthToken_refreshTokenHash_key" ON "McpOAuthToken"("refreshTokenHash")`,
  `CREATE INDEX IF NOT EXISTS "McpOAuthToken_userId_clientId_idx" ON "McpOAuthToken"("userId", "clientId")`,
  `CREATE INDEX IF NOT EXISTS "McpOAuthToken_orgId_idx" ON "McpOAuthToken"("orgId")`,
  `DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpOAuthCode_userId_fkey') THEN
    ALTER TABLE "McpOAuthCode" ADD CONSTRAINT "McpOAuthCode_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpOAuthToken_userId_fkey') THEN
    ALTER TABLE "McpOAuthToken" ADD CONSTRAINT "McpOAuthToken_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'McpOAuthToken_orgId_fkey') THEN
    ALTER TABLE "McpOAuthToken" ADD CONSTRAINT "McpOAuthToken_orgId_fkey"
      FOREIGN KEY ("orgId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$`,
];

/** P2021 is Prisma's "table does not exist"; the message test covers raw SQL. */
export function isMissingMcpOAuthTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return code === "P2021" || /McpOAuth(Client|Code|Token).*does not exist|relation "McpOAuth/i.test(message);
}
