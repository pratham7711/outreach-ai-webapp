/**
 * @jest-environment node
 *
 * lib/songs/spotifyReads: the one seam every Spotify play count passes
 * through, and where "0 means hidden" is applied, whichever reader answered.
 */
const mockCreateReader = jest.fn();
jest.mock("@/lib/platforms/spotifyWeb", () => ({
  ...jest.requireActual("@/lib/platforms/spotifyWeb"),
  createSpotifyReader: () => mockCreateReader(),
}));

import { openSpotifyReads, withPublishedCount } from "@/lib/songs/spotifyReads";
import type { SpotifyReader } from "@/lib/platforms/spotifyWeb";

const ID = "0AbCdEfGhIjKlMnOpQrStU";

function reader(playCount: number | null): SpotifyReader & { track: jest.Mock; search: jest.Mock; close: jest.Mock } {
  return {
    track: jest.fn(async (id: string) => ({ id, name: "Song", artists: ["A"], playCount })),
    search: jest.fn(async () => [{ id: ID, name: "Song", artists: ["A"] }]),
    close: jest.fn(async () => {}),
  };
}

it("reads a count Spotify shows as that count", async () => {
  const reads = openSpotifyReads({ reader: reader(5_631_276_067) });
  expect(await reads.readSpotifyTrack(ID)).toEqual({ id: ID, name: "Song", artists: ["A"], playCount: 5_631_276_067, countHidden: false });
});

it("reads 0 as a hidden count: no number, and said so", async () => {
  const reads = openSpotifyReads({ reader: reader(0) });
  expect(await reads.readSpotifyTrack(ID)).toMatchObject({ playCount: null, countHidden: true });
});

it("keeps a count the page did not give as missing, not hidden", async () => {
  expect(withPublishedCount({ id: ID, name: "Song", artists: [], playCount: null })).toMatchObject({ playCount: null, countHidden: false });
  expect(withPublishedCount(null)).toBeNull();
});

it("searches through its own function, and closes the reader", async () => {
  const r = reader(1);
  const reads = openSpotifyReads({ reader: r });
  expect(await reads.searchSpotifyTracks("q")).toHaveLength(1);
  expect(r.search).toHaveBeenCalledWith("q");
  await reads.close();
  expect(r.close).toHaveBeenCalled();
});

it("opens the anonymous web-player reader when given none", async () => {
  const r = reader(7);
  mockCreateReader.mockReturnValue(r);
  expect(await openSpotifyReads().readSpotifyTrack(ID)).toMatchObject({ playCount: 7 });
});
