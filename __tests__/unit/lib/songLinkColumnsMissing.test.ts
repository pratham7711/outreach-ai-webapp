/**
 * @jest-environment node
 *
 * Production runs the song-link code before Song.spotifyTrackId and
 * Song.instagramSoundId exist (lib/songs/songLinkDdl.ts). This runs the paths
 * that must keep working in that window -- the campaign list, creating a
 * campaign, the daily Spotify cron, the Performance tab and the audio settings
 * -- through the real Prisma client against a database without those columns.
 *
 * The database is a fake pg pool (__tests__/helpers/fakePgPrisma.ts), so what
 * is checked is the SQL Prisma really sends, not a mock's idea of it: any
 * statement that names either column fails the way Postgres fails it
 * (42703, "column does not exist"), and the rest are answered from a few
 * fixture rows. Mocked-db tests cannot see this: whether a query names the
 * column is decided by Prisma's SQL, not by the arguments a mock receives.
 */

type Row = Record<string, unknown>;
type Fake = import("../../helpers/fakePgPrisma").FakePg;

jest.mock("@/lib/db", () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("../../helpers/fakePgPrisma").createFakePgDb({ songLinkColumns: false })
);

const AUTH = { orgId: "org-1", userId: "user-1", role: "OWNER", campaignScope: "ALL", actorType: "user" };
jest.mock("@/lib/authenticate", () => ({
  authenticateRequest: async () => AUTH,
  getAuditActor: () => ({ actorId: "user-1", actorName: "Owner" }),
}));
jest.mock("@/lib/authz", () => ({
  requirePermission: async () => ({ ok: true, auth: AUTH }),
}));
jest.mock("@/lib/audit", () => ({ logAudit: jest.fn(async () => {}) }));
// The audio's own first reading reads TikTok; not what is under test.
jest.mock("@/lib/sounds/snapshot", () => ({ primeSongAudio: jest.fn(async () => {}) }));
// Instagram's audio page, answering for a licensed track with a count.
jest.mock("@/lib/platforms/instagramAudioUsage", () => ({
  readOneInstagramAudio: jest.fn(async () => ({
    ok: true,
    reading: { usesCount: 2_000_000, precision: "rounded", title: "Runaway", artist: "AURORA", coverImageUrl: null },
  })),
}));

import { NextRequest } from "next/server";
import { GET as listCampaigns, POST as createCampaign } from "@/app/api/campaigns/route";
import { GET as campaignPerformance } from "@/app/api/campaigns/[id]/performance/route";
import { PATCH as updateCampaign } from "@/app/api/campaigns/[id]/route";
import { snapshotSongStreams } from "@/lib/songs/streamSnapshot";
import type { SpotifyReader } from "@/lib/platforms/spotifyWeb";
import { namesSongLinkColumn } from "../../helpers/fakePgPrisma";

const { fake } = jest.requireMock("@/lib/db") as { fake: Fake };

const TRACK = "4uLU6hMCjMI75M1A2tKUQC";
const NOW = Date.parse("2026-10-25T04:00:00Z");

const req = (url: string, body?: unknown, method = "POST") =>
  new NextRequest(`http://localhost${url}`, body === undefined ? undefined : { method, body: JSON.stringify(body) });

const campaignRow = (over: Row = {}): Row => ({
  id: "camp-1",
  orgId: "org-1",
  title: "Launch",
  status: "IN_PROGRESS",
  campaignType: "BUDGET_BASED",
  currency: "USD",
  budget: null,
  songId: "song-1",
  createdById: "user-1",
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-20T00:00:00Z"),
  deletedAt: null,
  ...over,
});
const songRow = (over: Row = {}): Row => ({
  id: "song-1",
  orgId: "org-1",
  title: "Neon Skyline",
  artist: "Ava Reyes",
  isrc: null,
  soundId: null,
  deletedAt: null,
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  ...over,
});

/** Every statement that named a missing column. */
const namingColumn = () => fake.sql.filter(namesSongLinkColumn);
/** Writes are never what gets refused: only reads probe for the columns. */
const refusedWrites = () => fake.refused.filter((q) => !/^\s*SELECT\b/i.test(q));
const instagramAudioUrl = "https://www.instagram.com/reels/audio/1180417966306130/";

beforeEach(() => fake.reset({}));

it("the campaign list never names the column", async () => {
  fake.reset({ Campaign: [campaignRow()] });
  const res = await listCampaigns(req("/api/campaigns"));
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.campaigns.map((c: Row) => c.id)).toEqual(["camp-1"]);
  expect(namingColumn()).toEqual([]);
});

describe("creating a campaign", () => {
  const audioUrl = "https://www.tiktok.com/music/Neon-Skyline-7400000000000000009";
  const spotifyUrl = `https://open.spotify.com/track/${TRACK}?si=abc`;

  it("with a sound and a Spotify link: the campaign and its song are created, and the link is reported unsaved", async () => {
    const res = await createCampaign(req("/api/campaigns", { title: "Launch", audioUrl, spotifyUrl }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ title: "Launch", spotifyLinked: false });
    expect(body.songId).toEqual(expect.any(String));
    // One statement named the column: the readiness probe, before the transaction.
    expect(fake.refused).toHaveLength(1);
    expect(fake.refused[0]).toMatch(/^SELECT .*"Song"\."spotifyTrackId", "public"\."Song"\."instagramSoundId" FROM "public"\."Song"/);
    expect(fake.sql.indexOf(fake.refused[0])).toBeLessThan(fake.sql.indexOf("BEGIN"));
    // The song insert inside it does not name the column, and the transaction commits.
    const songInsert = fake.sql.find((q) => q.startsWith('INSERT INTO "public"."Song" '));
    expect(songInsert).toBeDefined();
    expect(songInsert).not.toContain("spotifyTrackId");
    expect(fake.sql).toContain("COMMIT");
    expect(fake.sql).not.toContain("ROLLBACK");
    expect(fake.sql.some((q) => q.startsWith('UPDATE "public"."Song"'))).toBe(false);
  });

  it("with only a Spotify link: the campaign is created with no song made for a link it cannot keep", async () => {
    const res = await createCampaign(req("/api/campaigns", { title: "Launch", spotifyUrl }));
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({ songId: null, spotifyLinked: false });
    expect(fake.sql.some((q) => q.startsWith('INSERT INTO "public"."Song" '))).toBe(false);
    expect(fake.sql).toContain("COMMIT");
  });

  it("with no Spotify link: nothing names the column at all", async () => {
    const res = await createCampaign(req("/api/campaigns", { title: "Launch", audioUrl }));
    expect(res.status).toBe(201);
    expect((await res.json()).spotifyLinked).toBeUndefined();
    expect(namingColumn()).toEqual([]);
  });

  it("with a TikTok sound and an Instagram audio: created on the TikTok sound, the Instagram audio reported unsaved", async () => {
    const res = await createCampaign(req("/api/campaigns", { title: "Launch", audioUrl, instagramAudioUrl }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body).toMatchObject({ instagramLinked: false });
    expect(body.spotifyLinked).toBeUndefined();
    expect(body.songId).toEqual(expect.any(String));
    // The readiness probe alone was refused, before the transaction, which commits.
    expect(fake.refused).toHaveLength(1);
    expect(fake.sql.indexOf(fake.refused[0])).toBeLessThan(fake.sql.indexOf("BEGIN"));
    expect(fake.sql).toContain("COMMIT");
    // One tracker, the TikTok one: an Instagram tracker with no slot to sit in would be an orphan that still costs a fetch a day.
    const soundInserts = fake.sql.filter((q) => q.startsWith('INSERT INTO "public"."TikTokSound" '));
    expect(soundInserts).toHaveLength(1);
    expect(fake.tables.TikTokSound.map((r) => r.platform)).toEqual(["TIKTOK"]);
  });

  it("with only an Instagram audio: it is the song's sound, as it always was", async () => {
    const res = await createCampaign(req("/api/campaigns", { title: "Launch", instagramAudioUrl }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.instagramLinked).toBeUndefined();
    expect(fake.tables.TikTokSound).toEqual([expect.objectContaining({ platform: "INSTAGRAM", tiktokSoundId: "1180417966306130", title: "Runaway" })]);
    const songInsert = fake.sql.find((q) => q.startsWith('INSERT INTO "public"."Song" '));
    expect(songInsert).toContain('"soundId"');
    expect(songInsert).not.toContain("instagramSoundId");
    expect(refusedWrites()).toEqual([]);
    expect(fake.sql).toContain("COMMIT");
  });
});

it("the daily Spotify cron matches by title and artist, as before links", async () => {
  fake.reset({ Song: [songRow()] });
  const reader = {
    search: jest.fn(async () => [{ id: TRACK, name: "Neon Skyline", artists: ["Ava Reyes"] }]),
    track: jest.fn(async (id: string) => ({ id, name: "Neon Skyline", artists: ["Ava Reyes"], playCount: 1234 })),
    close: jest.fn(async () => {}),
  } as unknown as SpotifyReader;
  const out = await snapshotSongStreams({ reader, nowMs: NOW, gapMs: 0 });
  expect(out).toMatchObject({ tableReady: true, linkReady: false, due: 1, read: 1, failed: 0 });
  expect(reader.search).toHaveBeenCalled();
  expect(fake.refused).toHaveLength(1);
  const written = fake.sql.find((q) => q.startsWith('INSERT INTO "public"."SongStreamSnapshot"'));
  expect(written).toBeDefined();
});

describe("the Performance tab", () => {
  beforeEach(() =>
    fake.reset({
      Campaign: [campaignRow()],
      Song: [songRow()],
      SongStreamSnapshot: [
        {
          id: "snap-1",
          songId: "song-1",
          orgId: "org-1",
          day: new Date("2026-10-24T00:00:00Z"),
          spotifyTrackId: TRACK,
          trackName: "Neon Skyline",
          trackArtists: "Ava Reyes",
          playCount: 1000,
          failure: null,
          recordedAt: new Date("2026-10-24T04:00:00Z"),
        },
      ],
    })
  );
  const params = { params: Promise.resolve({ id: "camp-1" }) };

  it("draws the Spotify card from the readings, as a matched track", async () => {
    const res = await campaignPerformance(req("/api/campaigns/camp-1/performance"), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.streams).toMatchObject({ songTitle: "Neon Skyline", totalPlays: 1000, trackSource: "matched", note: null });
    expect(body.streams.track.id).toBe(TRACK);
    // Each read that named a column was refused and asked again without it; nothing written.
    expect(fake.refused.length).toBeGreaterThan(0);
    expect(refusedWrites()).toEqual([]);
  });

  it("loads the audio settings panel, saying neither link can be saved yet", async () => {
    const res = await campaignPerformance(req("/api/campaigns/camp-1/performance?only=audio"), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.spotify).toEqual({ ready: false, trackId: null, url: null });
    expect(body.instagramReady).toBe(false);
    expect(refusedWrites()).toEqual([]);
  });
});

describe("the campaign's audio settings", () => {
  const params = { params: Promise.resolve({ id: "camp-1" }) };
  beforeEach(() => fake.reset({ Campaign: [campaignRow()], Song: [songRow()] }));
  const writes = () => fake.sql.filter((q) => /^(INSERT|UPDATE|DELETE)\b/i.test(q));

  it("refuses to save a Spotify link with 503 and writes nothing", async () => {
    const res = await updateCampaign(req("/api/campaigns/camp-1", { spotifyUrl: `https://open.spotify.com/track/${TRACK}` }, "PATCH"), params);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "spotify_link_unavailable",
      message: "Spotify links can't be saved yet. Try again later.",
    });
    expect(writes()).toEqual([]);
  });

  it("removing an older song's Instagram audio detaches the song, as Remove always did", async () => {
    fake.reset({
      Campaign: [campaignRow()],
      Song: [songRow({ soundId: "snd-ig" })],
      TikTokSound: [{ id: "snd-ig", orgId: "org-1", platform: "INSTAGRAM", tiktokSoundId: "1180417966306130", title: "Runaway", artist: "AURORA", coverImageUrl: null }],
    });
    const res = await updateCampaign(req("/api/campaigns/camp-1", { removeAudio: "INSTAGRAM" }, "PATCH"), params);
    expect(res.status).toBe(200);
    expect(fake.tables.Campaign[0].songId).toBeNull();
    // The song itself is left as it is, for any campaign that shares it.
    expect(fake.sql.some((q) => q.startsWith('UPDATE "public"."Song"'))).toBe(false);
    expect(refusedWrites()).toEqual([]);
  });

  it("attaching an Instagram audio finds or makes its song by that sound, as before", async () => {
    fake.reset({ Campaign: [campaignRow({ songId: null })], Song: [] });
    const res = await updateCampaign(req("/api/campaigns/camp-1", { audioUrl: instagramAudioUrl }, "PATCH"), params);
    expect(res.status).toBe(200);
    expect(fake.tables.TikTokSound).toEqual([expect.objectContaining({ platform: "INSTAGRAM", tiktokSoundId: "1180417966306130" })]);
    const songInsert = fake.sql.find((q) => q.startsWith('INSERT INTO "public"."Song" '));
    expect(songInsert).toContain('"soundId"');
    expect(refusedWrites()).toEqual([]);
    expect(fake.sql).toContain("COMMIT");
  });

  it("still saves everything else, without naming the column", async () => {
    const res = await updateCampaign(req("/api/campaigns/camp-1", { title: "Launch, renamed" }, "PATCH"), params);
    expect(res.status).toBe(200);
    expect(writes().some((q) => q.startsWith('UPDATE "public"."Campaign"'))).toBe(true);
    expect(namingColumn()).toEqual([]);
  });
});
