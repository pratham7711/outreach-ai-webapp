/**
 * @jest-environment node
 *
 * The Spotify card's figures from the daily readings. A day's streams are a
 * difference between two days' counts, so the cases that matter are the ones
 * where that difference would lie: a missed day, a count that went down, and a
 * song that was matched to a different track part-way through.
 */
import { streamFigures, type StreamRow } from "@/lib/songs/streams";

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
    expect(streamFigures([])).toEqual({ track: null, totalPlays: null, latestDay: null, lastDay: null, sinceFirst: null, daily: [] });
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

  it("keeps counts past 2^31 exact", () => {
    const out = streamFigures([r("2026-10-15", 5_631_276_067), r("2026-10-16", 5_632_000_000)]);
    expect(out.lastDay).toBe(723_933);
  });
});
