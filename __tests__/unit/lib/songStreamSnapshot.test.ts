/**
 * @jest-environment node
 *
 * The daily Spotify read. What is pinned here is how little it reads: nothing
 * before its table exists, one track page per song per day, a search only for a
 * song with no known track, and a stop as soon as Spotify starts refusing.
 */
const mockFindMany = jest.fn();
const mockUpsert = jest.fn();
const mockCreateReader = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    song: { findMany: (...a: unknown[]) => mockFindMany(...a) },
    songStreamSnapshot: { upsert: (...a: unknown[]) => mockUpsert(...a) },
  },
}));
jest.mock("@/lib/platforms/spotifyWeb", () => ({
  ...jest.requireActual("@/lib/platforms/spotifyWeb"),
  createSpotifyReader: () => mockCreateReader(),
}));

import { snapshotSongStreams, utcDay } from "@/lib/songs/streamSnapshot";
import type { SpotifyReader } from "@/lib/platforms/spotifyWeb";

const A = "0AbCdEfGhIjKlMnOpQrStU";
const NOW = Date.parse("2026-10-15T04:20:00Z");
const EARLIER = new Date("2026-10-10T00:00:00Z");

const dueSong = (over: Record<string, unknown> = {}) => ({
  id: "song-1",
  orgId: "org-1",
  title: "Neon Skyline",
  artist: "",
  isrc: null,
  updatedAt: EARLIER,
  sound: { artist: "Ava Reyes Official" },
  streamReadings: [] as { spotifyTrackId: string; recordedAt: Date }[],
  ...over,
});

function reader(over: Partial<SpotifyReader> = {}): SpotifyReader & { search: jest.Mock; track: jest.Mock } {
  return {
    search: jest.fn(async () => [{ id: A, name: "Neon Skyline", artists: ["Ava Reyes"] }]),
    track: jest.fn(async (id: string) => ({ id, name: "Neon Skyline", artists: ["Ava Reyes"], playCount: 1234 })),
    close: jest.fn(async () => {}),
    ...over,
  } as never;
}

const run = (r: SpotifyReader, over: Record<string, unknown> = {}) =>
  snapshotSongStreams({ reader: r, nowMs: NOW, gapMs: 0, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  mockUpsert.mockResolvedValue({});
});

it("opens no browser and reads nothing while the table does not exist", async () => {
  mockFindMany.mockRejectedValue(Object.assign(new Error('relation "SongStreamSnapshot" does not exist'), { code: "P2021" }));
  const out = await snapshotSongStreams({ nowMs: NOW });
  expect(out.tableReady).toBe(false);
  expect(mockCreateReader).not.toHaveBeenCalled();
  expect(mockUpsert).not.toHaveBeenCalled();
});

it("opens no browser when no song is due", async () => {
  mockFindMany.mockResolvedValue([]);
  const out = await snapshotSongStreams({ nowMs: NOW });
  expect(out).toMatchObject({ tableReady: true, due: 0, read: 0 });
  expect(mockCreateReader).not.toHaveBeenCalled();
});

it("asks only for songs on an open campaign with no reading today", async () => {
  mockFindMany.mockResolvedValue([]);
  await run(reader());
  const where = mockFindMany.mock.calls[0][0].where;
  expect(where.deletedAt).toBeNull();
  expect(where.campaigns.some.status.in).toEqual(["PENDING", "IN_PROGRESS"]);
  expect(where.streamReadings).toEqual({ none: { day: utcDay(NOW) } });
});

it("finds a new song's track by search, reads it once, and stores the day's count", async () => {
  mockFindMany.mockResolvedValue([dueSong()]);
  const r = reader();
  const out = await run(r);
  expect(r.search).toHaveBeenCalledTimes(1);
  expect(r.search).toHaveBeenCalledWith("Neon Skyline Ava Reyes Official");
  expect(r.track).toHaveBeenCalledTimes(1);
  expect(out).toMatchObject({ read: 1, matchedToday: 1, failed: 0, noMatch: 0 });
  const call = mockUpsert.mock.calls[0][0];
  expect(call.where).toEqual({ songId_day: { songId: "song-1", day: utcDay(NOW) } });
  expect(call.create).toMatchObject({ songId: "song-1", orgId: "org-1", spotifyTrackId: A, playCount: BigInt(1234), failure: null });
});

it("reuses the track an earlier day found, without searching again", async () => {
  mockFindMany.mockResolvedValue([dueSong({ streamReadings: [{ spotifyTrackId: A, recordedAt: new Date("2026-10-14T04:20:00Z") }] })]);
  const r = reader();
  const out = await run(r);
  expect(r.search).not.toHaveBeenCalled();
  expect(r.track).toHaveBeenCalledWith(A);
  expect(out.matchedToday).toBe(0);
});

it("searches again when the song was edited after its track was found", async () => {
  mockFindMany.mockResolvedValue([
    dueSong({ updatedAt: new Date("2026-10-14T12:00:00Z"), streamReadings: [{ spotifyTrackId: A, recordedAt: new Date("2026-10-14T04:20:00Z") }] }),
  ]);
  const r = reader();
  await run(r);
  expect(r.search).toHaveBeenCalledTimes(1);
});

it("records no match as the day's answer, so the song is not tried again today", async () => {
  mockFindMany.mockResolvedValue([dueSong()]);
  const r = reader({ search: jest.fn(async () => [{ id: A, name: "Neon Skyline", artists: ["Somebody Else"] }]) });
  const out = await run(r);
  expect(r.track).not.toHaveBeenCalled();
  expect(out).toMatchObject({ read: 0, noMatch: 1 });
  expect(mockUpsert.mock.calls[0][0].create).toMatchObject({ spotifyTrackId: null, playCount: null, failure: "no Spotify track with this title and artist" });
});

it("writes nothing on a dry run", async () => {
  mockFindMany.mockResolvedValue([dueSong()]);
  const out = await run(reader(), { dryRun: true });
  expect(out).toMatchObject({ dryRun: true, read: 1 });
  expect(mockUpsert).not.toHaveBeenCalled();
});

it("stops after three reads in a row throw, and leaves the rest for another day", async () => {
  mockFindMany.mockResolvedValue([1, 2, 3, 4, 5].map((n) => dueSong({ id: `song-${n}` })));
  const r = reader({ search: jest.fn(async () => { throw new Error("spotify: answered 429"); }) });
  const out = await run(r);
  expect(r.search).toHaveBeenCalledTimes(3);
  expect(out).toMatchObject({ failed: 3, skipped: 2 });
  expect(out.failures).toEqual({ "read failed: spotify: answered 429": 3 });
  // The three that were tried are marked for today; the two that were not get no row.
  expect(mockUpsert).toHaveBeenCalledTimes(3);
});

it("closes the browser it opened, even when a write fails", async () => {
  mockFindMany.mockResolvedValue([dueSong()]);
  const r = reader();
  mockCreateReader.mockReturnValue(r);
  mockUpsert.mockRejectedValue(new Error("db down"));
  await expect(snapshotSongStreams({ nowMs: NOW, gapMs: 0 })).rejects.toThrow("db down");
  expect(r.close).toHaveBeenCalled();
});
