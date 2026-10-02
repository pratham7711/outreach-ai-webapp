/**
 * @jest-environment node
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({ db: { $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn() } }));

import { LIST_APPROVAL_DDL, LIST_APPROVAL_TABLES } from "@/lib/lists/approvalSchemaDdl";
import { listApprovalTablesReady, resetListApprovalTablesCache } from "@/lib/lists/approvalTables";
import { GET, POST } from "@/app/api/admin/migrate-list-approval/route";
import { db } from "@/lib/db";

const mdb = db as unknown as Record<string, jest.Mock>;

describe("list-approval schema DDL", () => {
  it("runs every statement idempotently, so a re-run is a no-op and not an error", () => {
    for (const stmt of LIST_APPROVAL_DDL) expect(stmt).toMatch(/IF (NOT )?EXISTS/i);
  });

  it("holds exactly one statement per element", () => {
    // executeRawUnsafe uses the extended protocol, which rejects a
    // multi-statement string. A DO block's semicolons sit inside its $$ body.
    for (const stmt of LIST_APPROVAL_DDL) {
      expect(stmt.replace(/\$\$[\s\S]*\$\$/g, "")).not.toContain(";");
    }
  });

  it("creates every table the guard checks, and adds no column to an existing one", () => {
    const created = LIST_APPROVAL_DDL.map((s) => /CREATE TABLE IF NOT EXISTS "([^"]+)"/.exec(s)?.[1]).filter(Boolean);
    expect(created.sort()).toEqual([...LIST_APPROVAL_TABLES].sort());
    for (const stmt of LIST_APPROVAL_DDL) expect(stmt).not.toMatch(/ADD COLUMN/i);
  });

  it("keeps the tracked migration and the admin route on the same DDL", () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261002120000_list_approval/migration.sql"), "utf8");
    const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const stmt of LIST_APPROVAL_DDL) expect(normalise(sql)).toContain(normalise(stmt));
  });
});

describe("listApprovalTablesReady", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetListApprovalTablesCache();
  });

  it("is true only when both tables exist, and then stops asking", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([{ n: 2 }]);
    expect(await listApprovalTablesReady()).toBe(true);
    expect(await listApprovalTablesReady()).toBe(true);
    expect(mdb.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("reads false while a table is missing or the lookup throws", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([{ n: 1 }]);
    expect(await listApprovalTablesReady()).toBe(false);
    resetListApprovalTablesCache();
    mdb.$queryRawUnsafe.mockRejectedValue(new Error("down"));
    expect(await listApprovalTablesReady()).toBe(false);
  });
});

describe("/api/admin/migrate-list-approval", () => {
  const req = (method: string, token?: string) =>
    new NextRequest("http://localhost/api/admin/migrate-list-approval", {
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

  it("GET reports the missing tables without changing anything", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([{ table_name: "CreatorListDetail" }]);
    const body = await (await GET(req("GET", "test-admin-token"))).json();
    expect(body).toEqual({ ok: true, ready: false, missingTables: ["CreatorListItemDetail"] });
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("POST runs every statement once, in order, and reports before and after", async () => {
    mdb.$queryRawUnsafe
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(LIST_APPROVAL_TABLES.map((table_name) => ({ table_name })));
    const body = await (await POST(req("POST", "test-admin-token"))).json();
    expect(mdb.$executeRawUnsafe.mock.calls.map((c) => c[0])).toEqual(LIST_APPROVAL_DDL);
    expect(body.before.ready).toBe(false);
    expect(body.after).toEqual({ ready: true, missingTables: [] });
  });
});
