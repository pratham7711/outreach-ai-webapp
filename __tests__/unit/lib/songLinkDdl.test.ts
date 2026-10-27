/**
 * @jest-environment node
 *
 * The song link columns' DDL (Song.spotifyTrackId and Song.instagramSoundId)
 * and the admin route that applies it on production.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";

jest.mock("@/lib/db", () => ({
  db: { $queryRawUnsafe: jest.fn(), $executeRawUnsafe: jest.fn(), song: { count: jest.fn() } },
}));

import { SONG_LINK_COLUMNS, SONG_LINK_DDL, isMissingSongLinkColumn } from "@/lib/songs/songLinkDdl";
import { GET, POST } from "@/app/api/admin/migrate-song-links/route";
import { db } from "@/lib/db";

const mdb = db as unknown as Record<string, jest.Mock> & { song: { count: jest.Mock } };

describe("Song link columns DDL", () => {
  it("adds both nullable columns in ONE statement, so a database has both or neither", () => {
    expect(SONG_LINK_DDL[0]).toBe(
      `ALTER TABLE "Song" ADD COLUMN IF NOT EXISTS "spotifyTrackId" TEXT, ADD COLUMN IF NOT EXISTS "instagramSoundId" TEXT`
    );
    expect(SONG_LINK_COLUMNS).toEqual(["spotifyTrackId", "instagramSoundId"]);
  });

  it("is additive and idempotent: no drop, no NOT NULL, no default, every step guarded", () => {
    for (const stmt of SONG_LINK_DDL) {
      expect(stmt).not.toMatch(/\bDROP\b|ALTER COLUMN|NOT NULL|DEFAULT/i);
      expect(stmt).toMatch(/IF NOT EXISTS/);
    }
    // One statement per call (executeRawUnsafe): only the DO block may carry semicolons, inside it.
    for (const stmt of SONG_LINK_DDL.filter((s) => !s.startsWith("DO $$"))) expect(stmt).not.toContain(";");
  });

  it("gives the Instagram slot the same delete rule as the TikTok one", () => {
    const fk = SONG_LINK_DDL.find((s) => s.includes("Song_instagramSoundId_fkey")) ?? "";
    expect(fk).toMatch(/FOREIGN KEY \("instagramSoundId"\) REFERENCES "TikTokSound"\("id"\) ON DELETE SET NULL ON UPDATE CASCADE/);
    expect(SONG_LINK_DDL).toContain(`CREATE INDEX IF NOT EXISTS "Song_instagramSoundId_idx" ON "Song"("instagramSoundId")`);
  });

  it("keeps the tracked migration and the admin route on the same DDL", () => {
    const sql = readFileSync(path.join(process.cwd(), "prisma/migrations/20261026120000_song_links/migration.sql"), "utf8");
    const normalise = (s: string) => s.replace(/\s+/g, " ").replace(/;/g, "").trim();
    for (const stmt of SONG_LINK_DDL) expect(normalise(sql)).toContain(normalise(stmt));
  });

  it("matches the schema's own columns", () => {
    const schema = readFileSync(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
    const song = /model Song \{([\s\S]*?)\n\}/.exec(schema)?.[1] ?? "";
    expect(song).toMatch(/^\s*spotifyTrackId\s+String\?\s*$/m);
    expect(song).toMatch(/^\s*instagramSoundId\s+String\?\s*$/m);
    expect(song).toMatch(/@@index\(\[instagramSoundId\]\)/);
  });

  it("knows a missing column by Prisma's code, or by Postgres's words on a raw query", () => {
    expect(isMissingSongLinkColumn(Object.assign(new Error("The column `(not available)` does not exist"), { code: "P2022" }))).toBe(true);
    expect(isMissingSongLinkColumn(new Error('column "spotifyTrackId" does not exist'))).toBe(true);
    expect(isMissingSongLinkColumn(new Error('column s.instagramSoundId does not exist'))).toBe(true);
    expect(isMissingSongLinkColumn(new Error('relation "SongStreamSnapshot" does not exist'))).toBe(false);
    expect(isMissingSongLinkColumn(new Error("connection reset"))).toBe(false);
  });
});

describe("/api/admin/migrate-song-links", () => {
  const req = (method: string, token?: string) =>
    new NextRequest("http://localhost/api/admin/migrate-song-links", {
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
    expect((await POST(req("POST", "anything"))).status).toBe(404);
    process.env.ADMIN_MIGRATE_TOKEN = "test-admin-token";
    expect((await POST(req("POST", "wrong"))).status).toBe(401);
    expect((await GET(req("GET"))).status).toBe(401);
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(mdb.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("GET reports the missing columns without changing anything", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([]);
    const body = await (await GET(req("GET", "test-admin-token"))).json();
    expect(body).toEqual({ ok: true, ready: false, missingColumns: [...SONG_LINK_COLUMNS], linkedSongs: 0, instagramSongs: 0 });
    expect(mdb.$executeRawUnsafe).not.toHaveBeenCalled();
    // Counting linked songs would itself name the missing columns.
    expect(mdb.song.count).not.toHaveBeenCalled();
  });

  it("POST runs every statement once, in order, and reports before and after", async () => {
    mdb.$queryRawUnsafe
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(SONG_LINK_COLUMNS.map((column_name) => ({ column_name })));
    mdb.song.count.mockResolvedValue(0);
    const body = await (await POST(req("POST", "test-admin-token"))).json();
    expect(mdb.$executeRawUnsafe.mock.calls.map((c) => c[0])).toEqual(SONG_LINK_DDL);
    expect(body).toEqual({
      ok: true,
      before: { ready: false, missingColumns: [...SONG_LINK_COLUMNS], linkedSongs: 0, instagramSongs: 0 },
      after: { ready: true, missingColumns: [], linkedSongs: 0, instagramSongs: 0 },
    });
    expect(mdb.song.count).toHaveBeenCalledWith({ where: { spotifyTrackId: { not: null } } });
    expect(mdb.song.count).toHaveBeenCalledWith({ where: { instagramSoundId: { not: null } } });
  });

  it("is not ready with only one of the two columns", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([{ column_name: "spotifyTrackId" }]);
    const body = await (await GET(req("GET", "test-admin-token"))).json();
    expect(body).toMatchObject({ ready: false, missingColumns: ["instagramSoundId"] });
    expect(mdb.song.count).not.toHaveBeenCalled();
  });

  it("asks only about Song's own columns", async () => {
    mdb.$queryRawUnsafe.mockResolvedValue([]);
    await GET(req("GET", "test-admin-token"));
    const sql = mdb.$queryRawUnsafe.mock.calls[0][0] as string;
    expect(sql).toMatch(/table_name = 'Song'/);
    expect(sql).toMatch(/column_name IN \('spotifyTrackId', 'instagramSoundId'\)/);
  });
});
