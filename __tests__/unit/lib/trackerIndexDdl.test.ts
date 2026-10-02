/**
 * @jest-environment node
 *
 * Three indexes on the tracker tables, applied on production through an admin
 * route because `migrate deploy` must never run there.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
  },
}));

import { TRACKER_INDEXES, TRACKER_INDEX_DDL } from "@/lib/ops/trackerIndexDdl";
import { GET, POST } from "@/app/api/admin/migrate-tracker-indexes/route";
import { db } from "@/lib/db";

const mdb = db as unknown as { $queryRawUnsafe: jest.Mock; $executeRawUnsafe: jest.Mock };

describe("tracker index DDL", () => {
  it("runs every statement idempotently", () => {
    for (const stmt of TRACKER_INDEX_DDL) expect(stmt).toMatch(/^CREATE INDEX IF NOT EXISTS /);
  });

  it("creates indexes and nothing else", () => {
    for (const stmt of TRACKER_INDEX_DDL) {
      expect(stmt).not.toMatch(/\b(TABLE|COLUMN|DROP|DELETE|UPDATE|INSERT|ALTER)\b/i);
      expect(stmt).not.toContain(";");
    }
  });

  it("creates exactly the indexes the route reports on", () => {
    const created = TRACKER_INDEX_DDL.map((s) => /CREATE INDEX IF NOT EXISTS "([^"]+)"/.exec(s)?.[1]);
    expect(created).toEqual([...TRACKER_INDEXES]);
    for (const name of TRACKER_INDEXES) expect(name.length).toBeLessThanOrEqual(63);
  });

  it("keeps the tracked migration and the admin route on the same DDL", () => {
    const sql = readFileSync(
      path.join(process.cwd(), "prisma/migrations/20261003120000_tracker_indexes/migration.sql"),
      "utf8",
    );
    const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const stmt of TRACKER_INDEX_DDL) expect(normalise(sql)).toContain(normalise(stmt));
  });

  /* The names are Prisma's defaults for these @@index lines. If either side
     drifts, `prisma db push` on a dev database would build a second index
     beside the one production has, under a different name. */
  it("matches an @@index line in schema.prisma for every index", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const modelBody = (name: string) => new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1] ?? "";
    for (const stmt of TRACKER_INDEX_DDL) {
      const [, table, cols] = /ON "([^"]+)"\(([^)]+)\)/.exec(stmt)!;
      const fields = cols.split(",").map((c) => c.trim().replace(/"/g, "")).join(", ");
      expect(modelBody(table)).toContain(`@@index([${fields}])`);
    }
  });
});

describe("/api/admin/migrate-tracker-indexes", () => {
  const req = (method: string, token?: string) =>
    new NextRequest("http://localhost/api/admin/migrate-tracker-indexes", {
      method,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
  const saved = process.env.ADMIN_MIGRATE_TOKEN;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ADMIN_MIGRATE_TOKEN = "test-admin-token";
  });
  afterAll(() => {
    if (saved === undefined) delete process.env.ADMIN_MIGRATE_TOKEN;
    else process.env.ADMIN_MIGRATE_TOKEN = saved;
  });

  it("does not exist without ADMIN_MIGRATE_TOKEN, and refuses a wrong token", async () => {
    delete process.env.ADMIN_MIGRATE_TOKEN;
    expect((await GET(req("GET", "anything"))).status).toBe(404);
    process.env.ADMIN_MIGRATE_TOKEN = "test-admin-token";
    expect((await POST(req("POST", "wrong"))).status).toBe(401);
    expect((await POST(req("POST"))).status).toBe(401);
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("GET reports the missing indexes without changing anything", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([{ indexname: "TikTokSound_orgId_idx" }]);
    const body = await (await GET(req("GET", "test-admin-token"))).json();
    expect(body).toEqual({
      ok: true,
      ready: false,
      missingIndexes: ["SoundTrackerSnapshot_soundId_recordedAt_idx", "CreatorTrackerSnapshot_recordedAt_idx"],
    });
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("POST runs every statement once, in order, and reports before and after", async () => {
    mdb.$queryRawUnsafe
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(TRACKER_INDEXES.map((indexname) => ({ indexname })));
    const body = await (await POST(req("POST", "test-admin-token"))).json();
    expect(mdb.$executeRawUnsafe.mock.calls.map((c) => c[0])).toEqual(TRACKER_INDEX_DDL);
    expect(body.before.ready).toBe(false);
    expect(body.after).toEqual({ ready: true, missingIndexes: [] });
  });

  it("reports a failed statement instead of claiming success", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([]);
    mdb.$executeRawUnsafe.mockRejectedValueOnce(new Error("lock timeout"));
    const res = await POST(req("POST", "test-admin-token"));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toContain("lock timeout");
  });
});
