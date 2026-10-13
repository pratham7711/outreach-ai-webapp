/**
 * @jest-environment node
 *
 * The two web-player answers the Spotify reader parses. The shapes are the ones
 * Spotify's searchTracks and getTrack returned on 2026-10-14, cut down to the
 * fields read; the values are made up.
 */
import { isSpotifyTrackId, parseSearchTracks, parseTrack, spotifyTrackUrl } from "@/lib/platforms/spotifyWeb";

const ID = "0AbCdEfGhIjKlMnOpQrStU";

const searchAnswer = (items: unknown[]) => ({ data: { searchV2: { tracksV2: { items } } } });
const searchItem = (id: string, name: string, artists: string[]) => ({
  item: {
    __typename: "TrackResponseWrapper",
    data: {
      __typename: "Track",
      id,
      uri: `spotify:track:${id}`,
      name,
      artists: { items: artists.map((n) => ({ profile: { name: n }, uri: "spotify:artist:x" })) },
      albumOfTrack: { id: "alb", name: "Album" },
    },
  },
  matchedFields: [],
});

describe("parseSearchTracks", () => {
  it("lists each track with its artists, in Spotify's order", () => {
    const out = parseSearchTracks(
      searchAnswer([searchItem(ID, "Neon Skyline", ["Ava Reyes", "Milo"]), searchItem("1ZyXwVuTsRqPoNmLkJiHgF", "Other", ["X"])])
    );
    expect(out).toEqual([
      { id: ID, name: "Neon Skyline", artists: ["Ava Reyes", "Milo"] },
      { id: "1ZyXwVuTsRqPoNmLkJiHgF", name: "Other", artists: ["X"] },
    ]);
  });

  it("skips entries that are not a track with a valid id, and survives any other shape", () => {
    expect(parseSearchTracks(searchAnswer([{ item: { data: { id: "short", name: "x" } } }, {}]))).toEqual([]);
    expect(parseSearchTracks(null)).toEqual([]);
    expect(parseSearchTracks({ errors: [{ message: "nope" }] })).toEqual([]);
  });
});

describe("parseTrack", () => {
  const answer = (playcount: unknown) => ({
    data: {
      trackUnion: {
        __typename: "Track",
        id: ID,
        name: "Neon Skyline",
        playcount,
        firstArtist: { items: [{ profile: { name: "Ava Reyes" } }] },
        otherArtists: { items: [{ profile: { name: "Milo" } }] },
      },
    },
  });

  it("reads the play count Spotify sends as a string", () => {
    expect(parseTrack(answer("5631276067"))).toEqual({
      id: ID,
      name: "Neon Skyline",
      artists: ["Ava Reyes", "Milo"],
      playCount: 5631276067,
    });
  });

  it("gives no count, never 0, when the count is missing or not a whole number", () => {
    for (const bad of [undefined, null, "", "1.5", "-3", "abc"]) expect(parseTrack(answer(bad))?.playCount).toBeNull();
  });

  it("answers null for anything that is not a track", () => {
    expect(parseTrack({ data: { trackUnion: { __typename: "NotFound" } } })).toBeNull();
    expect(parseTrack(null)).toBeNull();
  });
});

describe("track ids", () => {
  it("accepts only Spotify's 22-character base-62 ids", () => {
    expect(isSpotifyTrackId(ID)).toBe(true);
    expect(isSpotifyTrackId("../../evil")).toBe(false);
    expect(isSpotifyTrackId(`${ID}x`)).toBe(false);
    expect(spotifyTrackUrl(ID)).toBe(`https://open.spotify.com/track/${ID}`);
  });
});
