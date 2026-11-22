/**
 * @jest-environment node
 *
 * The album tables' DDL (SongSpotifyAlbum, SongStreamTrackReading) and the
 * admin route that applies it on production.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: {
    $queryRawUnsafe: jest.fn(),
    $executeRawUnsafe: jest.fn(),
    songSpotifyAlbum: { count: jest.fn() },
    songStreamTrackReading: { count: jest.fn() },
  },
}));

import { SONG_ALBUM_DDL, SONG_ALBUM_TABLES, isMissingSongAlbumTable } from "@/lib/songs/songAlbumDdl";
import { GET, POST } from "@/app/api/admin/migrate-song-albums/route";
import { db } from "@/lib/db";

const mdb = db as unknown as Record<string, jest.Mock> & {
  songSpotifyAlbum: { count: jest.Mock };
  songStreamTrackReading: { count: jest.Mock };
};

describe("album tables DDL", () => {
  it("only creates: no drop, no change to an existing table, every step guarded", () => {
    for (const stmt of SONG_ALBUM_DDL) {
      expect(stmt).not.toMatch(/\bDROP\b|ALTER COLUMN|ALTER TABLE "Song"\b/i);
      expect(stmt).toMatch(/IF NOT EXISTS/);
    }
    for (const stmt of SONG_ALBUM_DDL.filter((s) => !s.startsWith("DO $$"))) expect(stmt).not.toContain(";");
  });

  it("keeps the tracked migration and the admin route on the same DDL", () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261122120000_song_spotify_albums/migration.sql"), "utf8");
    const normalise = (s: string) => s.replace(/\s+/g, " ").replace(/;/g, "").trim();
    for (const stmt of SONG_ALBUM_DDL) expect(normalise(sql)).toContain(normalise(stmt));
  });

  it("creates every column the schema names", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    for (const table of SONG_ALBUM_TABLES) {
      const model = new RegExp(`model ${table} \\{([\\s\\S]*?)\\n\\}`).exec(schema)?.[1] ?? "";
      const columns = [...model.matchAll(/^\s+(\w+)\s+(String|Int|BigInt|DateTime)\??/gm)].map((m) => m[1]);
      expect(columns.length).toBeGreaterThan(4);
      const create = SONG_ALBUM_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS "${table}"`)) ?? "";
      for (const c of columns) expect(create).toContain(`"${c}"`);
    }
  });

  it("knows a missing album table, and nothing else", () => {
    expect(isMissingSongAlbumTable(Object.assign(new Error("The table `public.SongSpotifyAlbum` does not exist"), { code: "P2021" }))).toBe(true);
    expect(isMissingSongAlbumTable(new Error('relation "SongStreamTrackReading" does not exist'))).toBe(true);
    expect(isMissingSongAlbumTable(new Error("connection reset"))).toBe(false);
  });
});

describe("/api/admin/migrate-song-albums", () => {
  const req = (method: string, token?: string) =>
    new NextRequest("http://localhost/api/admin/migrate-song-albums", {
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
    expect((await POST(req("POST", "anything"))).status).toBe(404);
    process.env.ADMIN_MIGRATE_TOKEN = "test-admin-token";
    expect((await POST(req("POST", "wrong"))).status).toBe(401);
    expect((await GET(req("GET"))).status).toBe(401);
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
  });

  it("GET reports the missing tables without changing anything", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([]);
    const body = await (await GET(req("GET", "test-admin-token"))).json();
    expect(body).toEqual({ ok: true, ready: false, missingTables: [...SONG_ALBUM_TABLES], albumSongs: 0, trackReadings: 0 });
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(mdb.songSpotifyAlbum.count).not.toHaveBeenCalled();
  });

  it("POST runs every statement once, in order, and reports before and after", async () => {
    mdb.$queryRawUnsafe.mockResolvedValueOnce([]).mockResolvedValueOnce(SONG_ALBUM_TABLES.map((table_name) => ({ table_name })));
    mdb.songSpotifyAlbum.count.mockResolvedValue(0);
    mdb.songStreamTrackReading.count.mockResolvedValue(0);
    const body = await (await POST(req("POST", "test-admin-token"))).json();
    expect(mdb.$executeRawUnsafe.mock.calls.map((c) => c[0])).toEqual(SONG_ALBUM_DDL);
    expect(body).toMatchObject({ ok: true, before: { ready: false }, after: { ready: true, missingTables: [] } });
  });
});
