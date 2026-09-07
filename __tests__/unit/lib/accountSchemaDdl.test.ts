import {
  CREATOR_ACCOUNT_COLUMN_DDL,
  CREATOR_ACCOUNT_INDEX_DDL,
  CREATOR_ACCOUNT_DDL,
  CREATOR_ACCOUNT_COLUMNS,
  CREATOR_ACCOUNT_INDEX_NAME,
} from "@/lib/platforms/accountSchemaDdl";

describe("CreatorSocialAccount schema DDL", () => {
  it("runs every statement idempotently, so a re-run is a no-op and not an error", () => {
    for (const stmt of CREATOR_ACCOUNT_DDL) {
      expect(stmt).toMatch(/IF (NOT )?EXISTS/i);
    }
  });

  it("holds exactly one statement per element", () => {
    // Prisma's executeRawUnsafe uses the extended protocol, which rejects a
    // multi-statement string outright.
    for (const stmt of CREATOR_ACCOUNT_DDL) {
      expect(stmt).not.toContain(";");
    }
  });

  it("adds a column for every name the route verifies", () => {
    // If these drift apart, /api/admin/migrate-creator-accounts reports `ready`
    // for a column no statement ever adds, or silently adds one it never checks.
    const added = CREATOR_ACCOUNT_COLUMN_DDL.map(
      (s) => /ADD COLUMN IF NOT EXISTS "([^"]+)"/.exec(s)?.[1],
    );
    expect(added.sort()).toEqual([...CREATOR_ACCOUNT_COLUMNS].sort());
  });

  it("creates the index the route verifies, and drops the narrower key it replaces", () => {
    const index = CREATOR_ACCOUNT_INDEX_DDL.join("\n");
    expect(index).toContain(CREATOR_ACCOUNT_INDEX_NAME);
    // Both spellings, because the same name may exist as a constraint in one
    // environment and a bare index in another.
    expect(index).toContain(`DROP CONSTRAINT IF EXISTS "CreatorSocialAccount_creatorId_platform_key"`);
    expect(index).toContain(`DROP INDEX IF EXISTS "CreatorSocialAccount_creatorId_platform_key"`);
  });

  it("adds the columns before the index that references one of them", () => {
    const platformUserId = CREATOR_ACCOUNT_DDL.findIndex((s) =>
      s.includes(`ADD COLUMN IF NOT EXISTS "platformUserId"`),
    );
    const createIndex = CREATOR_ACCOUNT_DDL.findIndex((s) => s.includes("CREATE UNIQUE INDEX"));
    expect(platformUserId).toBeGreaterThanOrEqual(0);
    expect(createIndex).toBeGreaterThan(platformUserId);
  });

  it("keeps the tracked migration and the admin route on the same DDL", () => {
    // The migration file is the copy that runs under `migrate deploy`; the
    // module is the copy that runs inside prod. A change to one that misses the
    // other leaves the two databases with different shapes.
    const sql = require("node:fs").readFileSync(
      require("node:path").join(
        process.cwd(),
        "prisma/migrations/20260906150000_creator_social_account_multi/migration.sql",
      ),
      "utf8",
    );
    const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const stmt of CREATOR_ACCOUNT_DDL) {
      expect(normalise(sql)).toContain(normalise(stmt));
    }
  });
});
