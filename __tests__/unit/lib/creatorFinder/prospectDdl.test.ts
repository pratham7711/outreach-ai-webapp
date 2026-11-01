/**
 * @jest-environment node
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: { $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn(), creatorProspect: { count: jest.fn() } },
}));

import {
  PROSPECT_COLUMNS,
  PROSPECT_DDL,
  PROSPECT_EVENT_COLUMNS,
  PROSPECT_EVENT_TABLE,
  PROSPECT_TABLE,
  isMissingProspectTable,
} from "@/lib/creatorFinder/prospectDdl";
import { GET, POST } from "@/app/api/admin/migrate-creator-finder/route";
import { db } from "@/lib/db";

const mdb = db as unknown as Record<string, jest.Mock> & { creatorProspect: { count: jest.Mock } };

describe("Creator Finder DDL", () => {
  it("runs every statement idempotently, one statement per element", () => {
    for (const stmt of PROSPECT_DDL) {
      expect(stmt).toMatch(/IF NOT EXISTS/i);
      expect(stmt.replace(/\$\$[\s\S]*\$\$/g, "")).not.toContain(";");
    }
  });

  it("only adds its own two tables and never touches an existing one", () => {
    for (const stmt of PROSPECT_DDL) {
      expect(stmt).not.toMatch(/\bDROP\b|ADD COLUMN|ALTER COLUMN/i);
      for (const m of stmt.matchAll(/ALTER TABLE "([^"]+)"/g)) expect([PROSPECT_TABLE, PROSPECT_EVENT_TABLE]).toContain(m[1]);
    }
  });

  it("creates every column the admin route checks for", () => {
    for (const col of PROSPECT_COLUMNS) expect(PROSPECT_DDL[0]).toContain(`"${col}"`);
    const events = PROSPECT_DDL.find((s) => s.includes(`CREATE TABLE IF NOT EXISTS "${PROSPECT_EVENT_TABLE}"`))!;
    for (const col of PROSPECT_EVENT_COLUMNS) expect(events).toContain(`"${col}"`);
  });

  it("keeps one card per handle per org, and drops a card's history with it", () => {
    const all = PROSPECT_DDL.join("\n");
    expect(all).toContain(`CREATE UNIQUE INDEX IF NOT EXISTS "CreatorProspect_orgId_platform_handle_key" ON "CreatorProspect"("orgId", "platform", "handle")`);
    expect(all).toMatch(/REFERENCES "CreatorProspect"\("id"\) ON DELETE CASCADE/);
  });

  it("keeps the tracked migration and the admin route on the same DDL", () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261101120000_creator_prospect/migration.sql"), "utf8");
    const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const stmt of PROSPECT_DDL) expect(normalise(sql)).toContain(normalise(stmt));
  });

  it("recognises a missing table from Prisma's code or Postgres's own words", () => {
    expect(isMissingProspectTable({ code: "P2021" })).toBe(true);
    expect(isMissingProspectTable(new Error('relation "CreatorProspect" does not exist'))).toBe(true);
    expect(isMissingProspectTable(new Error("timeout"))).toBe(false);
  });
});

describe("/api/admin/migrate-creator-finder", () => {
  const req = (method: string, token?: string) =>
    new NextRequest("http://localhost/api/admin/migrate-creator-finder", {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const saved = process.env.ADMIN_MIGRATE_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_MIGRATE_TOKEN = "test-admin-token";
  });
  afterAll(() => {
    process.env.ADMIN_MIGRATE_TOKEN = saved;
  });

  it("does not exist without ADMIN_MIGRATE_TOKEN, and refuses a wrong token", async () => {
    delete process.env.ADMIN_MIGRATE_TOKEN;
    expect((await GET(req("GET", "anything"))).status).toBe(404);
    process.env.ADMIN_MIGRATE_TOKEN = "test-admin-token";
    expect((await POST(req("POST", "wrong"))).status).toBe(401);
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("GET reports what is missing and changes nothing", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([]);
    const body = await (await GET(req("GET", "test-admin-token"))).json();
    expect(body.ready).toBe(false);
    expect(body.missingColumns).toHaveLength(PROSPECT_COLUMNS.length + PROSPECT_EVENT_COLUMNS.length);
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("POST runs every statement once, in order, and reports before and after", async () => {
    mdb.$queryRawUnsafe
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(PROSPECT_COLUMNS.map((column_name) => ({ column_name })))
      .mockResolvedValueOnce(PROSPECT_EVENT_COLUMNS.map((column_name) => ({ column_name })));
    mdb.creatorProspect.count.mockResolvedValue(0);
    const body = await (await POST(req("POST", "test-admin-token"))).json();
    expect(mdb.$executeRawUnsafe.mock.calls.map((c) => c[0])).toEqual(PROSPECT_DDL);
    expect(body.before.ready).toBe(false);
    expect(body.after).toEqual({ ready: true, missingColumns: [], prospects: 0 });
  });
});
