/**
 * @jest-environment node
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: { $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn(), songStreamSnapshot: { count: jest.fn() } },
}));

import { SONG_STREAM_COLUMNS, SONG_STREAM_DDL, SONG_STREAM_TABLE } from "@/lib/songs/streamSnapshotDdl";
import { GET, POST } from "@/app/api/admin/migrate-song-streams/route";
import { db } from "@/lib/db";

const mdb = db as unknown as Record<string, jest.Mock> & { songStreamSnapshot: { count: jest.Mock } };

describe("SongStreamSnapshot DDL", () => {
  it("runs every statement idempotently, so a re-run is a no-op and not an error", () => {
    for (const stmt of SONG_STREAM_DDL) expect(stmt).toMatch(/IF NOT EXISTS/i);
  });

  it("holds exactly one statement per element", () => {
    // executeRawUnsafe uses the extended protocol, which rejects a
    // multi-statement string. A DO block's semicolons sit inside its $$ body.
    for (const stmt of SONG_STREAM_DDL) expect(stmt.replace(/\$\$[\s\S]*\$\$/g, "")).not.toContain(";");
  });

  it("only adds: a new table, its index and its key, never a change to an existing table", () => {
    expect(SONG_STREAM_DDL[0]).toContain(`CREATE TABLE IF NOT EXISTS "${SONG_STREAM_TABLE}"`);
    for (const stmt of SONG_STREAM_DDL) {
      expect(stmt).not.toMatch(/\bDROP\b|ADD COLUMN|ALTER COLUMN/i);
      for (const m of stmt.matchAll(/ALTER TABLE "([^"]+)"/g)) expect(m[1]).toBe(SONG_STREAM_TABLE);
    }
  });

  it("creates every column the admin route checks for", () => {
    for (const col of SONG_STREAM_COLUMNS) expect(SONG_STREAM_DDL[0]).toContain(`"${col}"`);
  });

  it("goes when its song goes, and holds one reading per song per day", () => {
    expect(SONG_STREAM_DDL.join("\n")).toMatch(/REFERENCES "Song"\("id"\) ON DELETE CASCADE/);
    expect(SONG_STREAM_DDL.join("\n")).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS "SongStreamSnapshot_songId_day_key" ON "SongStreamSnapshot"\("songId", "day"\)/);
  });

  it("keeps the tracked migration and the admin route on the same DDL", () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261014150000_song_stream_snapshot/migration.sql"), "utf8");
    const normalise = (s: string) => s.replace(/\s+/g, " ").trim();
    for (const stmt of SONG_STREAM_DDL) expect(normalise(sql)).toContain(normalise(stmt));
  });
});

describe("/api/admin/migrate-song-streams", () => {
  const req = (method: string, token?: string) =>
    new NextRequest("http://localhost/api/admin/migrate-song-streams", {
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
    expect((await POST(req("POST"))).status).toBe(401);
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("GET reports the missing table without changing anything", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([]);
    const body = await (await GET(req("GET", "test-admin-token"))).json();
    expect(body).toEqual({ ok: true, ready: false, missingColumns: SONG_STREAM_COLUMNS, rows: 0 });
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(mdb.songStreamSnapshot.count).not.toHaveBeenCalled();
  });

  it("POST runs every statement once, in order, and reports before and after", async () => {
    mdb.$queryRawUnsafe
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(SONG_STREAM_COLUMNS.map((column_name) => ({ column_name })));
    mdb.songStreamSnapshot.count.mockResolvedValue(0);
    const body = await (await POST(req("POST", "test-admin-token"))).json();
    expect(mdb.$executeRawUnsafe.mock.calls.map((c) => c[0])).toEqual(SONG_STREAM_DDL);
    expect(body.before.ready).toBe(false);
    expect(body.after).toEqual({ ready: true, missingColumns: [], rows: 0 });
  });
});
