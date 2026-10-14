/**
 * @jest-environment node
 *
 * The two web-player answers the Spotify reader parses, and how the reader
 * drives its one page. The shapes are the ones Spotify's searchTracks and
 * getTrack returned on 2026-10-14, cut down to the fields read; the values are
 * made up.
 */
import {
  answersAsk,
  createSpotifyReader,
  isSpotifyTrackId,
  parseSearchTracks,
  parseTrack,
  spotifyTrackUrl,
} from "@/lib/platforms/spotifyWeb";
import type { LaunchedBrowser } from "@/lib/platforms/tiktokBrowser";

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

describe("answersAsk", () => {
  it("takes a search answer only for the same search term", () => {
    const ask = { kind: "search" as const, query: "Neon Skyline Ava Reyes" };
    expect(answersAsk(ask, { operationName: "searchTracks", variables: { searchTerm: "Neon Skyline Ava Reyes" } })).toBe(true);
    expect(answersAsk(ask, { operationName: "searchTracks", variables: { searchTerm: "Other Song" } })).toBe(false);
    expect(answersAsk(ask, { operationName: "searchDesktop", variables: { searchTerm: "Neon Skyline Ava Reyes" } })).toBe(false);
  });
  it("takes a track answer only about that track", () => {
    const ask = { kind: "track" as const, trackId: ID };
    expect(answersAsk(ask, { operationName: "getTrack", variables: { uri: `spotify:track:${ID}` } })).toBe(true);
    expect(answersAsk(ask, { operationName: "getTrack", variables: { uri: "spotify:track:1ZyXwVuTsRqPoNmLkJiHgF" } })).toBe(false);
  });
});

describe("createSpotifyReader", () => {
  type Call = { operationName: string; variables: Record<string, unknown>; status?: number; json?: unknown };
  const OTHER = "1ZyXwVuTsRqPoNmLkJiHgF";
  const trackJson = (id: string, playcount: string) => ({
    data: { trackUnion: { id, name: "Neon Skyline", playcount, firstArtist: { items: [{ profile: { name: "Ava Reyes" } }] } } },
  });

  /* A browser whose page answers each navigation with the pathfinder calls
     `script` lists for that URL, after goto has returned -- as the real page
     does, its data calls landing once the document has loaded. */
  function fakeBrowsers(script: (url: string) => Call[]) {
    const browsers: { newPage: jest.Mock; close: jest.Mock; listeners: Set<(r: unknown) => void>; gotos: string[] }[] = [];
    const launchBrowser = jest.fn(async () => {
      const listeners = new Set<(r: unknown) => void>();
      const gotos: string[] = [];
      const page = {
        route: jest.fn(async () => {}),
        on: (_: string, fn: (r: unknown) => void) => listeners.add(fn),
        off: (_: string, fn: (r: unknown) => void) => listeners.delete(fn),
        goto: jest.fn(async (url: string) => {
          gotos.push(url);
          for (const c of script(url)) {
            const res = {
              url: () => "https://api-partner.spotify.com/pathfinder/v2/query",
              status: () => c.status ?? 200,
              request: () => ({ postData: () => JSON.stringify({ operationName: c.operationName, variables: c.variables }) }),
              json: async () => c.json ?? null,
            };
            setTimeout(() => [...listeners].forEach((fn) => fn(res)), 0);
          }
        }),
      };
      const b = { newPage: jest.fn(async () => page), close: jest.fn(async () => {}), listeners, gotos };
      browsers.push(b);
      return b as unknown as LaunchedBrowser;
    });
    return { browsers, launchBrowser };
  }

  const searchFor = (term: string, ...names: string[]): Call => ({
    operationName: "searchTracks",
    variables: { searchTerm: term },
    json: searchAnswer(names.map((n, i) => searchItem(`${i}${ID.slice(1)}`, n, ["Ava Reyes"]))),
  });

  it("opens one browser and one page for the run, and navigates that page from read to read", async () => {
    const { browsers, launchBrowser } = fakeBrowsers((url) =>
      url.includes("/track/")
        ? [{ operationName: "getTrack", variables: { uri: `spotify:track:${ID}` }, json: trackJson(ID, "1234") }]
        : [searchFor(decodeURIComponent(url.split("/search/")[1].split("/")[0]), "Neon Skyline")]
    );
    const reader = createSpotifyReader({ launchBrowser, timeoutMs: 1_000 });
    expect(await reader.search("Neon Skyline Ava Reyes")).toHaveLength(1);
    expect(await reader.search("Neon Skyline")).toHaveLength(1);
    expect((await reader.track(ID))?.playCount).toBe(1234);

    expect(launchBrowser).toHaveBeenCalledTimes(1);
    expect(browsers[0].newPage).toHaveBeenCalledTimes(1);
    expect(browsers[0].gotos).toHaveLength(3);
    // Each read stops listening when it is done, so a page reused all run collects no listeners.
    expect(browsers[0].listeners.size).toBe(0);
    await reader.close();
    expect(browsers[0].close).toHaveBeenCalledTimes(1);
  });

  it("does not take the previous search's late answer for this one", async () => {
    const { launchBrowser } = fakeBrowsers(() => [searchFor("First search", "Wrong Song"), searchFor("Second search", "Right Song")]);
    const reader = createSpotifyReader({ launchBrowser, timeoutMs: 1_000 });
    expect((await reader.search("Second search")).map((t) => t.name)).toEqual(["Right Song"]);
  });

  it("does not take a recommended track's answer for the track asked about", async () => {
    const { launchBrowser } = fakeBrowsers(() => [
      { operationName: "getTrack", variables: { uri: `spotify:track:${OTHER}` }, json: trackJson(OTHER, "99") },
      { operationName: "getTrack", variables: { uri: `spotify:track:${ID}` }, json: trackJson(ID, "1234") },
    ]);
    const reader = createSpotifyReader({ launchBrowser, timeoutMs: 1_000 });
    expect(await reader.track(ID)).toMatchObject({ id: ID, playCount: 1234 });
  });

  it("throws when the answer never comes, closes that browser, and opens a fresh one for the next read", async () => {
    let answer = false;
    const { browsers, launchBrowser } = fakeBrowsers(() => (answer ? [searchFor("Neon Skyline", "Neon Skyline")] : []));
    const reader = createSpotifyReader({ launchBrowser, timeoutMs: 30 });
    await expect(reader.search("Neon Skyline")).rejects.toThrow("spotify searchTracks exceeded 30ms");
    await new Promise((r) => setTimeout(r, 0));
    expect(browsers[0].close).toHaveBeenCalled();

    answer = true;
    expect(await reader.search("Neon Skyline")).toHaveLength(1);
    expect(launchBrowser).toHaveBeenCalledTimes(2);
  });

  it("throws on an answer that is not a 200, and keeps the browser for the next read", async () => {
    let status = 429;
    const { browsers, launchBrowser } = fakeBrowsers(() => [{ ...searchFor("Neon Skyline", "Neon Skyline"), status }]);
    const reader = createSpotifyReader({ launchBrowser, timeoutMs: 1_000 });
    await expect(reader.search("Neon Skyline")).rejects.toThrow("spotify: answered 429");
    status = 200;
    expect(await reader.search("Neon Skyline")).toHaveLength(1);
    expect(launchBrowser).toHaveBeenCalledTimes(1);
    expect(browsers[0].close).not.toHaveBeenCalled();
  });

  it("opens nothing for an id that is not a Spotify track id, and closing an unused reader is a no-op", async () => {
    const { launchBrowser } = fakeBrowsers(() => []);
    const reader = createSpotifyReader({ launchBrowser });
    expect(await reader.track("../../evil")).toBeNull();
    await reader.close();
    expect(launchBrowser).not.toHaveBeenCalled();
  });
});
