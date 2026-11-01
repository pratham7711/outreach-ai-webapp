/**
 * @jest-environment node
 *
 * The Spotify card's figures from the daily readings. A day's streams are a
 * difference between two days' counts, so the cases that matter are the ones
 * where that difference would lie: a missed day, a count that went down, and a
 * song that was matched to a different track part-way through.
 */
const mockCampaign = jest.fn();
const mockReadings = jest.fn();
jest.mock("@/lib/db", () => ({
  db: {
    campaign: { findUnique: (...a: unknown[]) => mockCampaign(...a) },
    songStreamSnapshot: { findMany: (...a: unknown[]) => mockReadings(...a) },
  },
}));

import { ADD_LINK_NOTE, HIDDEN_COUNT_NOTE, loadCampaignStreams, streamFigures, type StreamRow } from "@/lib/songs/streams";
import { HIDDEN_COUNT_FAILURE } from "@/lib/songs/streamSnapshot";

const A = "0AbCdEfGhIjKlMnOpQrStU";
const B = "1ZyXwVuTsRqPoNmLkJiHgF";
const r = (day: string, playCount: number | null, over: Partial<StreamRow> = {}): StreamRow => ({
  day: new Date(`${day}T00:00:00Z`),
  spotifyTrackId: A,
  trackName: "Neon Skyline",
  trackArtists: "Ava Reyes",
  playCount: playCount === null ? null : BigInt(playCount),
  failure: playCount === null ? "track page gave no play count" : null,
  ...over,
});

describe("streamFigures", () => {
  it("has nothing before the first reading", () => {
    expect(streamFigures([])).toEqual({ track: null, totalPlays: null, latestDay: null, lastDay: null, sinceFirst: null, daily: [], plays: [] });
  });

  it("shows the count from one reading, and no daily figure until there is a day before it", () => {
    const out = streamFigures([r("2026-10-15", 1000)]);
    expect(out.totalPlays).toBe(1000);
    expect(out.latestDay).toBe("2026-10-15");
    expect(out.lastDay).toBeNull();
    expect(out.sinceFirst).toBeNull();
    expect(out.daily).toEqual([]);
    expect(out.track).toEqual({ id: A, url: `https://open.spotify.com/track/${A}`, name: "Neon Skyline", artists: "Ava Reyes" });
  });

  it("gives each day the difference from the day before, in any input order", () => {
    const out = streamFigures([r("2026-10-17", 1600), r("2026-10-15", 1000), r("2026-10-16", 1250)]);
    expect(out.daily).toEqual([
      { day: "2026-10-16", streams: 250 },
      { day: "2026-10-17", streams: 350 },
    ]);
    expect(out.lastDay).toBe(350);
    expect(out.sinceFirst).toEqual({ streams: 600, fromDay: "2026-10-15", days: 2 });
    expect(out.plays).toEqual([
      { day: "2026-10-15", count: 1000 },
      { day: "2026-10-16", count: 1250 },
      { day: "2026-10-17", count: 1600 },
    ]);
  });

  it("leaves a gap after a missed day instead of printing two days as one", () => {
    const out = streamFigures([r("2026-10-15", 1000), r("2026-10-17", 1600)]);
    expect(out.daily).toEqual([]);
    expect(out.lastDay).toBeNull();
    // The total since the first reading is still right across the gap.
    expect(out.sinceFirst).toEqual({ streams: 600, fromDay: "2026-10-15", days: 2 });
  });

  it("treats a failed day as missed, and the last good count as the total", () => {
    const out = streamFigures([r("2026-10-15", 1000), r("2026-10-16", 1300), r("2026-10-17", null)]);
    expect(out.totalPlays).toBe(1300);
    expect(out.latestDay).toBe("2026-10-16");
    expect(out.lastDay).toBe(300);
  });

  it("prints no figure, never a negative one, when Spotify's count went down", () => {
    const out = streamFigures([r("2026-10-15", 1000), r("2026-10-16", 900), r("2026-10-17", 950)]);
    expect(out.daily).toEqual([{ day: "2026-10-17", streams: 50 }]);
    expect(out.sinceFirst).toBeNull();
  });

  it("starts a new history when the song is matched to another track", () => {
    const out = streamFigures([
      r("2026-10-15", 1000),
      r("2026-10-16", 1200),
      r("2026-10-17", 50, { spotifyTrackId: B, trackName: "Neon Skyline (Radio Edit)" }),
      r("2026-10-18", 80, { spotifyTrackId: B, trackName: "Neon Skyline (Radio Edit)" }),
    ]);
    expect(out.track?.id).toBe(B);
    expect(out.totalPlays).toBe(80);
    expect(out.daily).toEqual([{ day: "2026-10-18", streams: 30 }]);
    expect(out.sinceFirst).toEqual({ streams: 30, fromDay: "2026-10-17", days: 1 });
  });

  it("reads a stored 0 as a hidden count, so the day Spotify starts counting is no spike", () => {
    // Rows from before the hidden-count rule stored Spotify's 0.
    const out = streamFigures([r("2026-10-15", 0), r("2026-10-16", 0), r("2026-10-17", 41_000)]);
    expect(out.totalPlays).toBe(41_000);
    expect(out.daily).toEqual([]);
    expect(out.lastDay).toBeNull();
    expect(out.sinceFirst).toBeNull();
  });

  it("keeps the last counted total and its day when the newest count is hidden", () => {
    const hidden = (day: string) => r(day, null, { failure: HIDDEN_COUNT_FAILURE });
    const out = streamFigures([r("2026-10-15", 1000), r("2026-10-16", 1300), hidden("2026-10-17")]);
    expect(out.totalPlays).toBe(1300);
    expect(out.latestDay).toBe("2026-10-16");
    expect(out.daily).toEqual([{ day: "2026-10-16", streams: 300 }]);
  });

  it("compares only days of one track across a link change, and keeps the old track's rows", () => {
    const rows = [
      r("2026-10-15", 1000),
      r("2026-10-16", 1200),
      r("2026-10-17", 90_000, { spotifyTrackId: B, trackName: "Linked" }),
      r("2026-10-18", 90_500, { spotifyTrackId: B, trackName: "Linked" }),
    ];
    const out = streamFigures(rows);
    expect(out.track?.id).toBe(B);
    // 10-17 is not 90,000 - 1,200: the two days are different tracks.
    expect(out.daily).toEqual([{ day: "2026-10-18", streams: 500 }]);
    // The old track's rows are still there to read; they just are not this card's history.
    expect(streamFigures(rows.slice(0, 2)).daily).toEqual([{ day: "2026-10-16", streams: 200 }]);
  });

  it("shows no figure for a newly linked track whose count is hidden, rather than the old track's", () => {
    const out = streamFigures([
      r("2026-10-15", 1000),
      r("2026-10-16", 1200),
      r("2026-10-17", null, { spotifyTrackId: B, failure: HIDDEN_COUNT_FAILURE }),
    ]);
    expect(out.track).toBeNull();
    expect(out.totalPlays).toBeNull();
  });

  it("keeps counts past 2^31 exact", () => {
    const out = streamFigures([r("2026-10-15", 5_631_276_067), r("2026-10-16", 5_632_000_000)]);
    expect(out.lastDay).toBe(723_933);
  });
});

describe("loadCampaignStreams", () => {
  const camp = (over: Record<string, unknown> = {}) => ({
    orgId: "org-1",
    status: "IN_PROGRESS",
    song: { id: "song-1", title: "Neon Skyline", deletedAt: null },
    ...over,
  });
  beforeEach(() => {
    mockCampaign.mockReset();
    mockReadings.mockReset();
  });

  it("answers null for another org's campaign without reading its song", async () => {
    mockCampaign.mockResolvedValue(camp({ orgId: "org-2" }));
    expect(await loadCampaignStreams("camp-1", "org-1")).toBeNull();
    expect(mockReadings).not.toHaveBeenCalled();
  });

  it("answers null for a campaign with no song, or a deleted one", async () => {
    mockCampaign.mockResolvedValue(camp({ song: null }));
    expect(await loadCampaignStreams("camp-1", "org-1")).toBeNull();
    mockCampaign.mockResolvedValue(camp({ song: { id: "song-1", title: "x", deletedAt: new Date() } }));
    expect(await loadCampaignStreams("camp-1", "org-1")).toBeNull();
  });

  it("reads only the song's rows in the campaign's org", async () => {
    mockCampaign.mockResolvedValue(camp());
    mockReadings.mockResolvedValue([]);
    await loadCampaignStreams("camp-1", "org-1");
    expect(mockReadings.mock.calls[0][0].where).toEqual({ songId: "song-1", orgId: "org-1" });
  });

  it("says the first reading is still to come on an open campaign, and shows nothing on a closed one", async () => {
    mockReadings.mockResolvedValue([]);
    mockCampaign.mockResolvedValue(camp());
    expect((await loadCampaignStreams("camp-1", "org-1"))?.note).toMatch(/first reading has not happened yet/);
    mockCampaign.mockResolvedValue(camp({ status: "COMPLETE" }));
    expect(await loadCampaignStreams("camp-1", "org-1")).toBeNull();
  });

  it("says no track was found when the day's row has no track", async () => {
    mockCampaign.mockResolvedValue(camp());
    mockReadings.mockResolvedValue([r("2026-10-15", null, { spotifyTrackId: null, failure: "no Spotify track with this title and artist" })]);
    expect((await loadCampaignStreams("camp-1", "org-1"))?.note).toMatch(/No Spotify track found/);
  });

  it("answers null while the table does not exist", async () => {
    mockCampaign.mockResolvedValue(camp());
    mockReadings.mockRejectedValue(Object.assign(new Error('relation "SongStreamSnapshot" does not exist'), { code: "P2021" }));
    expect(await loadCampaignStreams("camp-1", "org-1")).toBeNull();
  });

  it("names a linked track as linked, and a found one as matched", async () => {
    mockReadings.mockResolvedValue([r("2026-10-15", 1000)]);
    mockCampaign.mockResolvedValue(camp({ song: { id: "song-1", title: "Neon Skyline", deletedAt: null, spotifyTrackId: A } }));
    expect((await loadCampaignStreams("camp-1", "org-1"))?.trackSource).toBe("linked");
    mockCampaign.mockResolvedValue(camp({ song: { id: "song-1", title: "Neon Skyline", deletedAt: null, spotifyTrackId: null } }));
    expect((await loadCampaignStreams("camp-1", "org-1"))?.trackSource).toBe("matched");
    // Linked since, but the newest counted reading is still the matched track.
    mockCampaign.mockResolvedValue(camp({ song: { id: "song-1", title: "Neon Skyline", deletedAt: null, spotifyTrackId: B } }));
    expect((await loadCampaignStreams("camp-1", "org-1"))?.trackSource).toBe("matched");
  });

  it("says where the link goes when no track was found and none is linked", async () => {
    mockCampaign.mockResolvedValue(camp({ song: { id: "song-1", title: "Neon Skyline", deletedAt: null, spotifyTrackId: null } }));
    mockReadings.mockResolvedValue([r("2026-10-15", null, { spotifyTrackId: null, failure: "no Spotify track with this title and artist" })]);
    expect((await loadCampaignStreams("camp-1", "org-1"))?.note).toBe(
      `No Spotify track found with this song's title and artist (or ISRC). ${ADD_LINK_NOTE}`
    );
    mockReadings.mockResolvedValue([]);
    expect((await loadCampaignStreams("camp-1", "org-1"))?.note).toMatch(/first reading has not happened yet\. Add the Spotify link/);
  });

  it("does not ask for a link that is already there", async () => {
    mockCampaign.mockResolvedValue(camp({ song: { id: "song-1", title: "Neon Skyline", deletedAt: null, spotifyTrackId: A } }));
    mockReadings.mockResolvedValue([]);
    expect((await loadCampaignStreams("camp-1", "org-1"))?.note).not.toContain(ADD_LINK_NOTE);
  });

  it("says a hidden count is hidden, in the card's words", async () => {
    mockCampaign.mockResolvedValue(camp({ song: { id: "song-1", title: "Neon Skyline", deletedAt: null, spotifyTrackId: A } }));
    mockReadings.mockResolvedValue([r("2026-10-15", null, { failure: HIDDEN_COUNT_FAILURE })]);
    expect((await loadCampaignStreams("camp-1", "org-1"))?.note).toBe(
      "Spotify isn't showing a play count for this track yet (it hides counts for small or new tracks). Daily streams start the day it does."
    );
    expect(HIDDEN_COUNT_NOTE).toMatch(/^Spotify isn't showing/);
  });

  it("builds the card without the link while the link column does not exist, and asks for no link", async () => {
    mockCampaign
      .mockRejectedValueOnce(Object.assign(new Error("The column `(not available)` does not exist in the current database."), { code: "P2022" }))
      .mockResolvedValueOnce(camp());
    mockReadings.mockResolvedValue([r("2026-10-15", null, { spotifyTrackId: null, failure: "no Spotify track with this title and artist" })]);
    const out = await loadCampaignStreams("camp-1", "org-1");
    expect(mockCampaign).toHaveBeenCalledTimes(2);
    expect(mockCampaign.mock.calls[0][0].select.song.select.spotifyTrackId).toBe(true);
    expect(mockCampaign.mock.calls[1][0].select.song.select.spotifyTrackId).toBe(false);
    expect(out?.note).toMatch(/No Spotify track found/);
    expect(out?.note).not.toContain(ADD_LINK_NOTE);
  });

  it("does not swallow any other failure of the campaign read", async () => {
    mockCampaign.mockRejectedValue(new Error("connection reset"));
    await expect(loadCampaignStreams("camp-1", "org-1")).rejects.toThrow("connection reset");
    expect(mockCampaign).toHaveBeenCalledTimes(1);
  });
});
