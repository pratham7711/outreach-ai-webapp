// The creator-connection tables: CreatorAccountState and CreatorConnectToken.
// Every statement is idempotent because the same DDL may run more than once:
// /api/admin/migrate-creator-connect applies it on any database, and
// production has no usable _prisma_migrations lineage (never `migrate deploy`
// there).
//
// Additive only: two new tables and no new column on an existing one, so a
// deploy that lands before this runs leaves every existing query untouched.
// Every reader asks lib/creators/connectTables.ts first and treats a missing
// table as "nothing recorded", which is what every connection meant before.

export const CONNECT_TABLES = ["CreatorAccountState", "CreatorConnectToken"] as const;

function foreignKey(table: string, name: string, column: string, references: string): string {
  return `DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${name}') THEN
      ALTER TABLE "${table}" ADD CONSTRAINT "${name}"
        FOREIGN KEY ("${column}") REFERENCES ${references} ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
  END $$`;
}

export const CREATOR_CONNECT_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS "CreatorAccountState" (
    "accountId" TEXT NOT NULL,
    "grantorUserId" TEXT,
    "reconnectNeededAt" TIMESTAMP(3),
    "reconnectReason" TEXT,
    "displayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CreatorAccountState_pkey" PRIMARY KEY ("accountId")
  )`,
  `CREATE INDEX IF NOT EXISTS "CreatorAccountState_grantorUserId_idx" ON "CreatorAccountState"("grantorUserId")`,
  /* CASCADE: the state describes one connection and means nothing without it.
     Disconnect, the Meta callbacks and TikTok's authorization.removed all
     delete the account row, and its state goes with it. */
  foreignKey(
    "CreatorAccountState",
    "CreatorAccountState_accountId_fkey",
    "accountId",
    `"CreatorSocialAccount"("id")`,
  ),

  `CREATE TABLE IF NOT EXISTS "CreatorConnectToken" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    CONSTRAINT "CreatorConnectToken_pkey" PRIMARY KEY ("id")
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "CreatorConnectToken_tokenHash_key" ON "CreatorConnectToken"("tokenHash")`,
  `CREATE INDEX IF NOT EXISTS "CreatorConnectToken_orgId_creatorId_idx" ON "CreatorConnectToken"("orgId", "creatorId")`,
  foreignKey("CreatorConnectToken", "CreatorConnectToken_creatorId_fkey", "creatorId", `"Creator"("id")`),
];
