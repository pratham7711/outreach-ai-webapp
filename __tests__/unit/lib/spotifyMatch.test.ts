/**
 * @jest-environment node
 *
 * Which Spotify track a song is. A wrong match puts another artist's streams on
 * a brand's report, so what is asserted here is mostly what is refused.
 */
import { pickSpotifyTrack, searchQueries, splitArtistTitle, splitArtists, squash, type SongForMatch } from "@/lib/songs/spotifyMatch";
import type { SpotifyTrackHit } from "@/lib/platforms/spotifyWeb";

const song = (over: Partial<SongForMatch> = {}): SongForMatch => ({
  title: "Neon Skyline",
  artist: "Ava Reyes",
  isrc: null,
  soundArtist: null,
  ...over,
});
const hit = (id: string, name: string, ...artists: string[]): SpotifyTrackHit => ({ id: id.padEnd(22, "x"), name, artists });

describe("squash", () => {
  it("drops case, accents, punctuation and a featured-artist tail", () => {
    expect(squash("Café del Mar (feat. Somebody)")).toBe("cafedelmar");
    expect(squash("Neon Skyline - feat. X")).toBe("neonskyline");
    expect(squash("NEON  skyline!")).toBe("neonskyline");
  });

  it("keeps letters in any script, so a non-Latin title is not squashed to nothing", () => {
    expect(squash("सपने")).toBe("सपने");
    expect(squash("सपना")).not.toBe(squash("सपने"));
    expect(squash("사랑")).toBe("사랑");
  });
});

describe("splitArtists", () => {
  it("keeps the whole credit and each artist in it", () => {
    expect(splitArtists("Ava Reyes & Milo, Kit")).toEqual(["avareyesmilokit", "avareyes", "milo", "kit"]);
  });
  it("is empty for a blank artist", () => {
    expect(splitArtists("  ")).toEqual([]);
    expect(splitArtists(null)).toEqual([]);
  });
});

describe("searchQueries", () => {
  it("tries a well-formed ISRC first, then title and artist", () => {
    expect(searchQueries(song({ isrc: "us-um7-17-03861" }))).toEqual(["isrc:USUM71703861", "Neon Skyline Ava Reyes"]);
  });
  it("ignores an ISRC that is not one", () => {
    expect(searchQueries(song({ isrc: "12345" }))).toEqual(["Neon Skyline Ava Reyes"]);
  });
  it("uses the TikTok sound's artist when the song has none", () => {
    expect(searchQueries(song({ artist: "", soundArtist: "avareyesofficial" }))).toEqual(["Neon Skyline avareyesofficial"]);
  });
});

describe("pickSpotifyTrack", () => {
  it("takes the track whose title and artist are the song's", () => {
    const hits = [hit("a", "Neon Skyline", "Somebody Else"), hit("b", "Neon Skyline", "Ava Reyes")];
    expect(pickSpotifyTrack(song(), hits)).toEqual({ hit: hits[1], how: "artist-exact" });
  });

  it("accepts a TikTok account name that carries a suffix the Spotify artist does not", () => {
    const hits = [hit("a", "Neon Skyline", "Ava Reyes")];
    expect(pickSpotifyTrack(song({ artist: "", soundArtist: "Ava Reyes Official" }), hits)?.how).toBe("artist-contained");
  });

  it("prefers an exact artist over a contained one, wherever it sits in the results", () => {
    const hits = [hit("a", "Neon Skyline", "Ava Reyes Official"), hit("b", "Neon Skyline", "Ava Reyes")];
    expect(pickSpotifyTrack(song(), hits)?.hit.id).toBe(hits[1].id);
  });

  it("does not let a name under four letters match by sitting inside another", () => {
    // "Ava" is inside "Ava Reyes", but three letters is anybody.
    const hits = [hit("a", "Neon Skyline", "Ava")];
    expect(pickSpotifyTrack(song(), hits)).toBeNull();
  });

  it("never matches on the title alone", () => {
    const hits = [hit("a", "Neon Skyline", "Somebody Else"), hit("b", "Neon Skyline", "Another One")];
    expect(pickSpotifyTrack(song(), hits)).toBeNull();
  });

  it("never matches a different title by the same artist", () => {
    expect(pickSpotifyTrack(song(), [hit("a", "Neon Skyline (Remix)", "Ava Reyes")])).toBeNull();
    expect(pickSpotifyTrack(song(), [hit("a", "Neon", "Ava Reyes")])).toBeNull();
  });

  it("matches nothing when there is no artist to check against", () => {
    expect(pickSpotifyTrack(song({ artist: "", soundArtist: null }), [hit("a", "Neon Skyline", "Ava Reyes")])).toBeNull();
  });

  it("reads past a featured-artist tail on either side", () => {
    const hits = [hit("a", "Neon Skyline (feat. Milo)", "Ava Reyes", "Milo")];
    expect(pickSpotifyTrack(song({ title: "Neon Skyline" }), hits)?.hit.id).toBe(hits[0].id);
  });
});

describe('a title written "<artist> - <title>"', () => {
  const mj = (over: Partial<SongForMatch> = {}) => song({ title: "Michael Jackson - Thriller", artist: "", soundArtist: null, ...over });

  it("splits at the first spaced dash only, and never inside a name", () => {
    expect(splitArtistTitle("Michael Jackson - Thriller")).toEqual({ artist: "Michael Jackson", title: "Thriller" });
    expect(splitArtistTitle("Ava Reyes \u2013 Neon Skyline - Live")).toEqual({ artist: "Ava Reyes", title: "Neon Skyline - Live" });
    expect(splitArtistTitle("Jay-Z")).toBeNull();
    expect(splitArtistTitle("Neon Skyline")).toBeNull();
    expect(splitArtistTitle("- Thriller")).toBeNull();
  });

  it("matches Thriller by Michael Jackson with no artist on the song", () => {
    const hits = [hit("a", "Thriller", "Somebody Else"), hit("b", "Thriller", "Michael Jackson")];
    expect(pickSpotifyTrack(mj(), hits)).toEqual({ hit: hits[1], how: "artist-exact" });
  });

  it("refuses Thriller by another artist: the written artist is the check", () => {
    expect(pickSpotifyTrack(mj(), [hit("a", "Thriller", "Fall Out Boy")])).toBeNull();
  });

  it("is still never a match on the title alone", () => {
    expect(pickSpotifyTrack(mj(), [hit("a", "Thriller", "Somebody Else"), hit("b", "Thriller", "Another One")])).toBeNull();
    // Nor the whole string as a title with the sound's account as the artist.
    expect(pickSpotifyTrack(mj({ soundArtist: "mjofficial" }), [hit("a", "Thriller", "Not Him")])).toBeNull();
  });

  it("holds the written artist to the same four-letter rule as any other", () => {
    expect(pickSpotifyTrack(mj({ title: "Mic - Thriller" }), [hit("a", "Thriller", "Michael Jackson")])).toBeNull();
    expect(pickSpotifyTrack(mj({ title: "Michael Jackson Official - Thriller" }), [hit("a", "Thriller", "Michael Jackson")])?.how).toBe(
      "artist-contained"
    );
  });

  it("still takes the whole title when that is the track's name", () => {
    const hits = [hit("a", "Michael Jackson - Thriller", "Tribute Band")];
    expect(pickSpotifyTrack(mj({ artist: "Tribute Band" }), hits)?.hit.id).toBe(hits[0].id);
  });

  it("searches the split title and artist as well", () => {
    expect(searchQueries(mj())).toEqual(["Michael Jackson - Thriller", "Thriller Michael Jackson"]);
    expect(searchQueries(mj({ soundArtist: "mjofficial" }))).toEqual([
      "Michael Jackson - Thriller mjofficial",
      "Thriller Michael Jackson",
    ]);
  });
});
