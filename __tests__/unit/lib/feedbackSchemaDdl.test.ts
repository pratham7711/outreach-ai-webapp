/**
 * @jest-environment node
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({ db: { $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn() } }));

import { FEEDBACK_DDL, FEEDBACK_TABLES } from "@/lib/feedback/feedbackSchemaDdl";
import { feedbackTablesReady, resetFeedbackTablesCache } from "@/lib/feedback/feedbackTables";
import { GET, POST } from "@/app/api/admin/migrate-feedback/route";
import { db } from "@/lib/db";

const mdb = db as unknown as Record<string, jest.Mock>;

describe("feedback schema DDL", () => {
  it("runs every statement idempotently, so a re-run is a no-op and not an error", () => {
    for (const stmt of FEEDBACK_DDL) expect(stmt).toMatch(/IF (NOT )?EXISTS/i);
  });

  it("holds exactly one statement per element", () => {
    // executeRawUnsafe uses the extended protocol, which rejects a
    // multi-statement string. A DO block's semicolons sit inside its $$ body.
    for (const stmt of FEEDBACK_DDL) {
      expect(stmt.replace(/\$\$[\s\S]*\$\$/g, "")).not.toContain(";");
    }
  });

  it("creates every table the guard checks, and adds no column to an existing one", () => {
    const created = FEEDBACK_DDL.map((s) => /CREATE TABLE IF NOT EXISTS "([^"]+)"/.exec(s)?.[1]).filter(Boolean);
    expect(created.sort()).toEqual([...FEEDBACK_TABLES].sort());
    for (const stmt of FEEDBACK_DDL) expect(stmt).not.toMatch(/ADD COLUMN/i);
  });

  it("keeps the tracked migration and the admin route on the same DDL", () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261011090000_feedback/migration.sql"), "utf8");
    const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const stmt of FEEDBACK_DDL) expect(normalise(sql)).toContain(normalise(stmt));
  });
});

describe("feedbackTablesReady", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetFeedbackTablesCache();
  });

  it("is true once the table exists, and then stops asking", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([{ n: 1 }]);
    expect(await feedbackTablesReady()).toBe(true);
    expect(await feedbackTablesReady()).toBe(true);
    expect(mdb.$queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("reads false while the table is missing or the lookup throws", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([{ n: 0 }]);
    expect(await feedbackTablesReady()).toBe(false);
    resetFeedbackTablesCache();
    mdb.$queryRawUnsafe.mockRejectedValue(new Error("down"));
    expect(await feedbackTablesReady()).toBe(false);
  });
});

describe("/api/admin/migrate-feedback", () => {
  const req = (method: string, token?: string) =>
    new NextRequest("http://localhost/api/admin/migrate-feedback", {
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

  it("GET reports the missing table without changing anything", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([]);
    const body = await (await GET(req("GET", "test-admin-token"))).json();
    expect(body).toEqual({ ok: true, ready: false, missingTables: ["Feedback"] });
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("POST runs every statement once, in order, and reports before and after", async () => {
    mdb.$queryRawUnsafe
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(FEEDBACK_TABLES.map((table_name) => ({ table_name })));
    const body = await (await POST(req("POST", "test-admin-token"))).json();
    expect(mdb.$executeRawUnsafe.mock.calls.map((c) => c[0])).toEqual(FEEDBACK_DDL);
    expect(body.before.ready).toBe(false);
    expect(body.after).toEqual({ ready: true, missingTables: [] });
  });
});
