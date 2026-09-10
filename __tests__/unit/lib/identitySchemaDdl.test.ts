import {
  IDENTITY_ACCOUNT_COLUMNS,
  IDENTITY_COLUMN_DDL,
  IDENTITY_CREATOR_COLUMNS,
  IDENTITY_DDL,
  IDENTITY_FK_DDL,
  IDENTITY_INDEX_DDL,
  IDENTITY_INDEX_NAMES,
  IDENTITY_RETAINED_KEY,
} from "@/lib/platforms/identitySchemaDdl";

const MIGRATION =
  "prisma/migrations/20260909120000_creator_account_identity/migration.sql";

describe("identity-owned connections schema DDL", () => {
  it("runs every statement idempotently, so a re-run is a no-op and not an error", () => {
    for (const stmt of IDENTITY_COLUMN_DDL) expect(stmt).toMatch(/IF NOT EXISTS/i);
    for (const stmt of IDENTITY_INDEX_DDL) expect(stmt).toMatch(/IF NOT EXISTS/i);
  });

  it("guards each foreign key with duplicate_object, because Postgres has no ADD CONSTRAINT IF NOT EXISTS", () => {
    const guards = IDENTITY_FK_DDL.filter((s) => s.includes("ADD CONSTRAINT"));
    expect(guards).toHaveLength(2);
    for (const stmt of guards) {
      expect(stmt).toMatch(/DO \$\$ BEGIN/);
      expect(stmt).toMatch(/EXCEPTION WHEN duplicate_object THEN NULL; END \$\$/);
      // NOT VALID takes no long lock and cannot fail on a partially
      // backfilled table.
      expect(stmt).toContain("NOT VALID");
    }
    const validates = IDENTITY_FK_DDL.filter((s) => s.includes("VALIDATE CONSTRAINT"));
    expect(validates).toHaveLength(2);
  });

  it("never cascades a delete onto a row holding a credential", () => {
    // Destroying the only copy of a token leaves the OAuth grant live at
    // TikTok / Meta / Google with nothing left that can revoke it.
    for (const stmt of IDENTITY_FK_DDL) {
      expect(stmt).not.toMatch(/ON DELETE CASCADE/);
    }
    for (const stmt of IDENTITY_FK_DDL.filter((s) => s.includes("ADD CONSTRAINT"))) {
      expect(stmt).toContain("ON DELETE SET NULL");
    }
  });

  it("holds exactly one statement per element, except the DO blocks that need internal semicolons", () => {
    // Prisma's executeRawUnsafe uses the extended protocol, which rejects a
    // multi-statement string outright. A DO block is one statement whatever
    // its body contains.
    for (const stmt of IDENTITY_DDL) {
      if (stmt.trimStart().startsWith("DO $$")) continue;
      expect(stmt).not.toContain(";");
    }
  });

  it("is purely additive: no drops, no NOT NULL, no data written", () => {
    // This is what makes the step deployable ahead of the code that reads the
    // columns, and reversible by dropping them.
    for (const stmt of IDENTITY_DDL) {
      expect(stmt).not.toMatch(/DROP COLUMN|DROP TABLE|SET NOT NULL|DROP NOT NULL/i);
      /* Leading keyword only: a foreign key's referential actions spell
         ON DELETE / ON UPDATE and are not DML. */
      for (const line of stmt.split("\n")) {
        expect(line.trimStart()).not.toMatch(/^(INSERT|UPDATE|DELETE)\b/i);
      }
    }
  });

  it("adds a column for every name the route verifies", () => {
    // If these drift apart the route reports `ready` for a column no statement
    // adds, or silently adds one it never checks.
    const added = IDENTITY_COLUMN_DDL.map((s) => {
      const table = /ALTER TABLE "([^"]+)"/.exec(s)?.[1];
      const column = /ADD COLUMN IF NOT EXISTS "([^"]+)"/.exec(s)?.[1];
      return `${table}.${column}`;
    });
    const verified = [
      ...IDENTITY_ACCOUNT_COLUMNS.map((c) => `CreatorSocialAccount.${c}`),
      ...IDENTITY_CREATOR_COLUMNS.map((c) => `Creator.${c}`),
    ];
    expect(added.sort()).toEqual(verified.sort());
  });

  it("creates every index the route verifies", () => {
    const sql = IDENTITY_INDEX_DDL.join("\n");
    for (const name of IDENTITY_INDEX_NAMES) expect(sql).toContain(name);
  });

  it("keeps the legacy unique key rather than replacing it", () => {
    // Legacy org-owned rows carry creatorUserId NULL, so the new unique key
    // cannot see them and this is the only thing still validating them.
    for (const stmt of IDENTITY_DDL) {
      expect(stmt).not.toContain(`DROP INDEX IF EXISTS "${IDENTITY_RETAINED_KEY}"`);
      expect(stmt).not.toContain(`DROP CONSTRAINT IF EXISTS "${IDENTITY_RETAINED_KEY}"`);
    }
  });

  it("does not add an unconditional unique on (platform, platformUserId)", () => {
    // Two orgs legitimately roster the same person today, which is why
    // lib/oauth/metaDeletion.ts deletes by that pair with deleteMany.
    const unique = IDENTITY_DDL.filter((s) => /CREATE UNIQUE INDEX/i.test(s));
    for (const stmt of unique) {
      expect(stmt).toContain(`"creatorUserId"`);
    }
  });

  it("adds the columns before any index or foreign key that references them", () => {
    const lastColumn = IDENTITY_DDL.reduce(
      (acc, s, i) => (/ADD COLUMN IF NOT EXISTS/.test(s) ? i : acc),
      -1,
    );
    const firstIndex = IDENTITY_DDL.findIndex((s) => /CREATE (UNIQUE )?INDEX/i.test(s));
    const firstFk = IDENTITY_DDL.findIndex((s) => s.includes("ADD CONSTRAINT"));
    expect(lastColumn).toBeGreaterThanOrEqual(0);
    expect(firstIndex).toBeGreaterThan(lastColumn);
    expect(firstFk).toBeGreaterThan(lastColumn);
  });

  it("adds each foreign key before validating it", () => {
    const add = IDENTITY_FK_DDL.findIndex((s) =>
      s.includes(`"CreatorSocialAccount_creatorUserId_fkey"`),
    );
    const validate = IDENTITY_FK_DDL.findIndex(
      (s) => s.includes("VALIDATE CONSTRAINT") && s.includes("CreatorSocialAccount"),
    );
    expect(add).toBeGreaterThanOrEqual(0);
    expect(validate).toBeGreaterThan(add);
  });

  it("keeps the tracked migration and the admin route on the same DDL", () => {
    // The migration file runs under `migrate deploy`; the module runs inside
    // prod. A change to one that misses the other leaves the two databases
    // with different shapes.
    const sql = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), MIGRATION),
      "utf8",
    );
    const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const stmt of IDENTITY_DDL) {
      expect(normalise(sql)).toContain(normalise(stmt));
    }
  });

  it("carries no statement in the migration that the module does not have", () => {
    // The other direction of the same drift, which the account-schema test
    // does not cover: a statement hand-added to the SQL would never run in
    // production.
    const sql: string = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), MIGRATION),
      "utf8",
    );
    const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
    const moduleStatements = new Set(IDENTITY_DDL.map(normalise));
    /* Statements are separated by a blank line, so the semicolons INSIDE a
       DO $$ ... $$ body are not mistaken for statement ends. */
    const fileStatements = sql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n")
      .split(/;\s*\n\s*\n/)
      .map((s) => normalise(s.replace(/;\s*$/, "")))
      .filter(Boolean);
    expect(fileStatements).toHaveLength(IDENTITY_DDL.length);
    for (const stmt of fileStatements) {
      expect(moduleStatements).toContain(stmt);
    }
  });
});
