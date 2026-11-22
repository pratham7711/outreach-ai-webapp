/**
 * @jest-environment node
 *
 * An album's figures from one reading per track per day. Every figure is a sum
 * of per-track figures, so the cases that matter are the ones where a
 * difference of album totals would lie: a version whose hidden count starts to
 * show, a track missing from one day, and a count Spotify corrects downwards.
 */
import { albumFigures, type AlbumTrackRow } from "@/lib/songs/albumStreams";

const O = "1aaaaaaaaaaaaaaaaaaaaa";
const S = "2bbbbbbbbbbbbbbbbbbbbb";
const F = "3ccccccccccccccccccccc";
const NAMES: Record<string, string> = { [O]: "Original", [S]: "Slowed", [F]: "Sped Up" };
const POS: Record<string, number> = { [O]: 1001, [S]: 1002, [F]: 1003 };
const r = (day: string, trackId: string, count: number | null): AlbumTrackRow => ({
  day: new Date(`${day}T00:00:00Z`),
  trackId,
  trackName: NAMES[trackId],
  position: POS[trackId],
  playCount: count === null ? null : BigInt(count),
});

it("has nothing before the first reading", () => {
  expect(albumFigures([])).toEqual({ totalPlays: null, latestDay: null, lastDay: null, sinceFirst: null, daily: [], plays: [], versions: [] });
});

it("adds every version up, and each day's streams are the sum of each version's increase", () => {
  const out = albumFigures([
    r("2026-11-20", O, 1000), r("2026-11-20", S, 500), r("2026-11-20", F, 100),
    r("2026-11-21", O, 1100), r("2026-11-21", S, 650), r("2026-11-21", F, 130),
  ]);
  expect(out.totalPlays).toBe(1880);
  expect(out.latestDay).toBe("2026-11-21");
  expect(out.daily).toEqual([{ day: "2026-11-21", streams: 280 }]);
  expect(out.lastDay).toBe(280);
  expect(out.sinceFirst).toEqual({ streams: 280, fromDay: "2026-11-20", days: 1 });
  expect(out.plays).toEqual([{ day: "2026-11-20", count: 1600 }, { day: "2026-11-21", count: 1880 }]);
  expect(out.versions.map((v) => [v.name, v.totalPlays, v.lastDay, v.sinceFirst])).toEqual([
    ["Original", 1100, 100, 100],
    ["Slowed", 650, 150, 150],
    ["Sped Up", 130, 30, 30],
  ]);
  expect(out.versions[0].url).toBe(`https://open.spotify.com/track/${O}`);
});

it("does not count a version's whole history on the day Spotify starts showing its count", () => {
  const out = albumFigures([
    r("2026-11-20", O, 1000), r("2026-11-20", S, null),
    r("2026-11-21", O, 1050), r("2026-11-21", S, 40_000),
  ]);
  expect(out.totalPlays).toBe(41_050);
  expect(out.daily).toEqual([{ day: "2026-11-21", streams: 50 }]);
  expect(out.sinceFirst?.streams).toBe(50);
  expect(out.versions.find((v) => v.id === S)).toMatchObject({ totalPlays: 40_000, lastDay: null, sinceFirst: null });
});

it("treats 0 as a hidden count, and lists a hidden version without a number", () => {
  const out = albumFigures([r("2026-11-21", O, 900), r("2026-11-21", S, 0)]);
  expect(out.totalPlays).toBe(900);
  expect(out.versions.find((v) => v.id === S)?.totalPlays).toBeNull();
});

it("leaves a gap for a missed day rather than printing two days as one", () => {
  const out = albumFigures([r("2026-11-18", O, 100), r("2026-11-20", O, 300), r("2026-11-21", O, 350)]);
  expect(out.daily).toEqual([{ day: "2026-11-21", streams: 50 }]);
  expect(out.sinceFirst).toEqual({ streams: 250, fromDay: "2026-11-18", days: 3 });
});

it("adds nothing for a version whose count went down", () => {
  const out = albumFigures([r("2026-11-20", O, 500), r("2026-11-20", S, 300), r("2026-11-21", O, 450), r("2026-11-21", S, 330)]);
  expect(out.daily).toEqual([{ day: "2026-11-21", streams: 30 }]);
  expect(out.versions.find((v) => v.id === O)).toMatchObject({ lastDay: null, sinceFirst: null });
});

it("lists versions in album order, whatever order the rows come in", () => {
  const out = albumFigures([r("2026-11-21", F, 3), r("2026-11-21", O, 1), r("2026-11-21", S, 2)]);
  expect(out.versions.map((v) => v.name)).toEqual(["Original", "Slowed", "Sped Up"]);
});
