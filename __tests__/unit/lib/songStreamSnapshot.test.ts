/**
 * @jest-environment node
 *
 * The daily Spotify read. What is pinned here is how little it reads: nothing
 * before its table exists, one track page per song per day, a search only for a
 * song with no known track (and never for a linked one), and a stop as soon as
 * Spotify starts refusing. Also the first reading after a link is saved, and a
 * count Spotify hides, which is stored as no count rather than as 0.
 */
const mockFindMany = jest.fn();
const mockFindFirst = jest.fn();
const mockFindUnique = jest.fn();
const mockUpsert = jest.fn();
const mockCreateReader = jest.fn();

jest.mock("@/lib/db", () => ({
  db: {
    song: { findMany: (...a: unknown[]) => mockFindMany(...a), findFirst: (...a: unknown[]) => mockFindFirst(...a) },
    songStreamSnapshot: {
      upsert: (...a: unknown[]) => mockUpsert(...a),
      findUnique: (...a: unknown[]) => mockFindUnique(...a),
    },
  },
}));
jest.mock("@/lib/platforms/spotifyWeb", () => ({
  ...jest.requireActual("@/lib/platforms/spotifyWeb"),
  createSpotifyReader: () => mockCreateReader(),
}));

import { HIDDEN_COUNT_FAILURE, primeSongStreams, snapshotSongStreams, utcDay } from "@/lib/songs/streamSnapshot";
import type { SpotifyReader } from "@/lib/platforms/spotifyWeb";

const A = "0AbCdEfGhIjKlMnOpQrStU";
const LINKED = "9ZyXwVuTsRqPoNmLkJiHgF";
const missingLinkColumn = () =>
  Object.assign(new Error("The column `(not available)` does not exist in the current database."), { code: "P2022" });
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

it("still reads on a dry run before the table exists, so Spotify can be checked first, and writes nothing", async () => {
  const missing = Object.assign(new Error('relation "SongStreamSnapshot" does not exist'), { code: "P2021" });
  const withoutReadings: Record<string, unknown> = dueSong();
  delete withoutReadings.streamReadings;
  mockFindMany.mockRejectedValueOnce(missing).mockResolvedValueOnce([withoutReadings]);
  const r = reader();
  const out = await run(r, { dryRun: true });
  expect(out).toMatchObject({ tableReady: false, dryRun: true, due: 1, read: 1 });
  expect(r.search).toHaveBeenCalledTimes(1);
  expect(mockUpsert).not.toHaveBeenCalled();
  // The second read cannot name the missing relation, or it would fail the same way.
  expect(JSON.stringify(mockFindMany.mock.calls[1][0])).not.toContain("streamReadings");
});

it("opens no browser when no song is due", async () => {
  mockFindMany.mockResolvedValue([]);
  const out = await snapshotSongStreams({ nowMs: NOW });
  expect(out).toMatchObject({ tableReady: true, due: 0, read: 0 });
  expect(mockCreateReader).not.toHaveBeenCalled();
});

it("asks only for songs on an open campaign, or a finished one in its 30-day tail, with no reading today", async () => {
  mockFindMany.mockResolvedValue([]);
  await run(reader());
  const where = mockFindMany.mock.calls[0][0].where;
  expect(where.deletedAt).toBeNull();
  expect(where.campaigns.some.deletedAt).toBeNull();
  const [open, tail] = where.campaigns.some.OR;
  expect(open.status.in).toEqual(["PENDING", "IN_PROGRESS"]);
  expect(tail.status).toBe("COMPLETE");
  expect(tail.posts.some.removedAt).toBeNull();
  expect(tail.posts.some.postedAt.gte).toEqual(new Date(NOW - 30 * 86_400_000));
  expect(where.streamReadings).toEqual({ none: { day: utcDay(NOW) } });
});

it("puts running campaigns' songs first when more are due than one run reads", async () => {
  const songs = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => dueSong({ id: `${prefix}-${i}` }));
  mockFindMany
    .mockResolvedValueOnce(songs("any", 3))
    .mockResolvedValueOnce(songs("open", 1))
    .mockResolvedValueOnce(songs("tail", 1));
  const out = await run(reader(), { limit: 2 });
  expect(out.due).toBe(2);
  expect(mockFindMany.mock.calls[0][0].take).toBe(3);
  expect(mockFindMany.mock.calls[1][0].where.campaigns.some.status.in).toEqual(["PENDING", "IN_PROGRESS"]);
  expect(mockFindMany.mock.calls[2][0].where.id).toEqual({ notIn: ["open-0"] });
  expect(mockFindMany.mock.calls[2][0].take).toBe(1);
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

describe("a song with a linked track", () => {
  it("reads the linked track and never searches, whatever an earlier day found", async () => {
    mockFindMany.mockResolvedValue([
      dueSong({ spotifyTrackId: LINKED, streamReadings: [{ spotifyTrackId: A, recordedAt: new Date("2026-10-14T04:20:00Z") }] }),
    ]);
    const r = reader();
    const out = await run(r);
    expect(r.search).not.toHaveBeenCalled();
    expect(r.track).toHaveBeenCalledTimes(1);
    expect(r.track).toHaveBeenCalledWith(LINKED);
    expect(out).toMatchObject({ read: 1, matchedToday: 0, linkReady: true });
    expect(mockUpsert.mock.calls[0][0].create).toMatchObject({ spotifyTrackId: LINKED, playCount: BigInt(1234) });
  });

  it("asks for the link with the due songs", async () => {
    mockFindMany.mockResolvedValue([]);
    await run(reader());
    expect(mockFindMany.mock.calls[0][0].select.spotifyTrackId).toBe(true);
  });

  it("matches by title and artist, as before links, while the link column does not exist", async () => {
    mockFindMany.mockRejectedValueOnce(missingLinkColumn()).mockResolvedValueOnce([dueSong()]);
    const r = reader();
    const out = await run(r);
    expect(out).toMatchObject({ linkReady: false, tableReady: true, read: 1, matchedToday: 1 });
    expect(r.search).toHaveBeenCalledTimes(1);
    // The second ask leaves the column out of the query altogether.
    expect(mockFindMany.mock.calls[1][0].select.spotifyTrackId).toBe(false);
    expect(mockFindMany.mock.calls[1][0].select.streamReadings).toBeDefined();
  });

  it("still reads nothing when neither the link column nor the readings table exists", async () => {
    mockFindMany
      .mockRejectedValueOnce(missingLinkColumn())
      .mockRejectedValueOnce(Object.assign(new Error('relation "SongStreamSnapshot" does not exist'), { code: "P2021" }));
    const out = await snapshotSongStreams({ nowMs: NOW });
    expect(out).toMatchObject({ tableReady: false, linkReady: false });
    expect(mockCreateReader).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});

describe("a count Spotify hides", () => {
  it("stores no count and says why, rather than a 0 that would later read as a day's streams", async () => {
    mockFindMany.mockResolvedValue([dueSong({ spotifyTrackId: LINKED })]);
    const r = reader({ track: jest.fn(async (id: string) => ({ id, name: "Quiet Song", artists: ["Ava Reyes"], playCount: 0 })) });
    const out = await run(r);
    expect(out).toMatchObject({ read: 0, hidden: 1, failed: 0 });
    expect(mockUpsert.mock.calls[0][0].create).toMatchObject({
      spotifyTrackId: LINKED,
      trackName: "Quiet Song",
      playCount: null,
      failure: HIDDEN_COUNT_FAILURE,
    });
    expect(HIDDEN_COUNT_FAILURE).toBe("play count hidden by Spotify");
  });
});

describe("primeSongStreams -- the first reading after a link is saved", () => {
  const linkedSong = (over: Record<string, unknown> = {}) => ({
    title: "Neon Skyline",
    artist: "",
    isrc: null,
    spotifyTrackId: LINKED,
    sound: null,
    ...over,
  });
  const prime = (r: SpotifyReader) => primeSongStreams("org-1", "song-1", { reader: r, nowMs: NOW });

  beforeEach(() => {
    mockFindFirst.mockReset();
    mockFindUnique.mockReset();
  });

  it("reads only a song of this org on an open campaign", async () => {
    mockFindFirst.mockResolvedValue(null);
    const r = reader();
    expect(await prime(r)).toBe("not-due");
    const where = mockFindFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({ id: "song-1", orgId: "org-1", deletedAt: null });
    expect(where.campaigns.some.status.in).toEqual(["PENDING", "IN_PROGRESS"]);
    expect(r.track).not.toHaveBeenCalled();
  });

  it("reads nothing for a song with no link", async () => {
    mockFindFirst.mockResolvedValue(linkedSong({ spotifyTrackId: null }));
    const r = reader();
    expect(await prime(r)).toBe("no-link");
    expect(r.track).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("reads nothing when today's row is already the linked track's", async () => {
    mockFindFirst.mockResolvedValue(linkedSong());
    mockFindUnique.mockResolvedValue({ spotifyTrackId: LINKED });
    const r = reader();
    expect(await prime(r)).toBe("already-read");
    expect(r.track).not.toHaveBeenCalled();
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("replaces today's row when it is another track's, reading the linked track without a search", async () => {
    mockFindFirst.mockResolvedValue(linkedSong());
    mockFindUnique.mockResolvedValue({ spotifyTrackId: A });
    const r = reader();
    expect(await prime(r)).toBe("read");
    expect(r.search).not.toHaveBeenCalled();
    expect(r.track).toHaveBeenCalledWith(LINKED);
    const call = mockUpsert.mock.calls[0][0];
    expect(call.where).toEqual({ songId_day: { songId: "song-1", day: utcDay(NOW) } });
    expect(call.update).toMatchObject({ spotifyTrackId: LINKED, playCount: BigInt(1234), failure: null });
    expect(call.create).toMatchObject({ songId: "song-1", orgId: "org-1", spotifyTrackId: LINKED });
  });

  it("writes the first day's row when there is none", async () => {
    mockFindFirst.mockResolvedValue(linkedSong());
    mockFindUnique.mockResolvedValue(null);
    expect(await prime(reader())).toBe("read");
    expect(mockUpsert).toHaveBeenCalledTimes(1);
  });

  it("stores a hidden count as hidden here too", async () => {
    mockFindFirst.mockResolvedValue(linkedSong());
    mockFindUnique.mockResolvedValue(null);
    const r = reader({ track: jest.fn(async (id: string) => ({ id, name: "Quiet", artists: [], playCount: 0 })) });
    expect(await prime(r)).toBe("hidden");
    expect(mockUpsert.mock.calls[0][0].create).toMatchObject({ playCount: null, failure: HIDDEN_COUNT_FAILURE });
  });

  it("writes nothing when the read throws, so the cron still reads the song today", async () => {
    mockFindFirst.mockResolvedValue(linkedSong());
    mockFindUnique.mockResolvedValue(null);
    const r = reader({ track: jest.fn(async () => { throw new Error("browser launch: timed out"); }) });
    expect(await prime(r)).toBe("read-failed");
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("does nothing while the link column or the readings table is missing", async () => {
    mockFindFirst.mockRejectedValue(missingLinkColumn());
    expect(await prime(reader())).toBe("not-ready");
    mockFindFirst.mockResolvedValue(linkedSong());
    mockFindUnique.mockRejectedValue(Object.assign(new Error('relation "SongStreamSnapshot" does not exist'), { code: "P2021" }));
    const r = reader();
    expect(await prime(r)).toBe("not-ready");
    expect(r.track).not.toHaveBeenCalled();
  });

  it("closes the browser it opened", async () => {
    mockFindFirst.mockResolvedValue(linkedSong());
    mockFindUnique.mockResolvedValue(null);
    const r = reader();
    mockCreateReader.mockReturnValue(r);
    await primeSongStreams("org-1", "song-1", { nowMs: NOW });
    expect(r.close).toHaveBeenCalled();
  });
});
