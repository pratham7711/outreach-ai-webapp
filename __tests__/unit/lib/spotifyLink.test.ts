/**
 * @jest-environment node
 *
 * A pasted Spotify link, and only a track. What matters is the paste people
 * actually make -- a regional page, a share link with ?si=, the app's short
 * link -- and the near misses that name the wrong thing: the album the song is
 * on, a playlist, the artist.
 */
import { SPOTIFY_LINK_ERRORS, parseSpotifyLink } from "@/lib/songs/spotifyLink";
import { checkSpotifyTrack, resolveSpotifyLink } from "@/lib/songs/spotifyLinkResolve";

const ID = "4uLU6hMCjMI75M1A2tKUQC";
const TRACK = `https://open.spotify.com/track/${ID}`;

describe("parseSpotifyLink", () => {
  it.each([
    [TRACK],
    [`${TRACK}?si=a1b2c3d4e5f60718`],
    [`https://open.spotify.com/intl-de/track/${ID}`],
    [`https://open.spotify.com/intl-pt/track/${ID}?si=x&nd=1`],
    [`https://open.spotify.com/embed/track/${ID}`],
    [`https://open.spotify.com/embed/track/${ID}?utm_source=generator`],
    [`spotify:track:${ID}`],
    [`open.spotify.com/track/${ID}`],
    [`http://open.spotify.com/track/${ID}/`],
    [`  ${TRACK}  `],
  ])("reads %s as the track", (link) => {
    expect(parseSpotifyLink(link)).toEqual({ kind: "track", trackId: ID, url: TRACK });
  });

  it.each([
    [`https://open.spotify.com/album/${ID}`, "album", "That's an album link. Open the song and copy its link."],
    [`https://open.spotify.com/intl-fr/album/${ID}?si=1`, "album", "That's an album link. Open the song and copy its link."],
    [`spotify:album:${ID}`, "album", "That's an album link. Open the song and copy its link."],
    [`https://open.spotify.com/playlist/${ID}`, "playlist", "That's a playlist link. Open the song and copy its link."],
    [`https://open.spotify.com/artist/${ID}`, "artist", "That's an artist link. Open the song and copy its link."],
    [`https://open.spotify.com/episode/${ID}`, "episode", "That's a podcast episode link. Open the song and copy its link."],
    [`https://open.spotify.com/show/${ID}`, "show", "That's a podcast link. Open the song and copy its link."],
  ])("names %s as what it is", (link, reason, message) => {
    expect(parseSpotifyLink(link)).toEqual({ kind: "invalid", reason });
    expect(SPOTIFY_LINK_ERRORS[reason as keyof typeof SPOTIFY_LINK_ERRORS]).toBe(message);
  });

  it.each([
    [""],
    ["not a link"],
    [`https://www.tiktok.com/music/Song-7400000000000000009`],
    [`https://open.spotify.com.evil.example/track/${ID}`],
    [`https://open.spotify.com/track/${ID.slice(0, 21)}`],
    [`https://open.spotify.com/track/${ID}x`],
    [`https://open.spotify.com/track/${ID}/extra`],
    [`https://open.spotify.com/`],
    [`https://open.spotify.com/user/someone`],
    [`ftp://open.spotify.com/track/${ID}`],
    ["spotify:track"],
  ])("refuses %s as not a Spotify track link", (link) => {
    expect(parseSpotifyLink(link)).toEqual({ kind: "invalid", reason: "not_track" });
  });

  it("says the generic refusal in the words the form shows", () => {
    expect(SPOTIFY_LINK_ERRORS.not_track).toBe("That isn't a Spotify track link.");
  });

  it("leaves a short link to be followed, always over https", () => {
    expect(parseSpotifyLink("https://spotify.link/AbCdEf123")).toEqual({ kind: "short-link", url: "https://spotify.link/AbCdEf123" });
    expect(parseSpotifyLink("http://spotify.app.link/AbCdEf123?_p=x")).toEqual({
      kind: "short-link",
      url: "https://spotify.app.link/AbCdEf123?_p=x",
    });
    expect(parseSpotifyLink("https://spotify.link/")).toEqual({ kind: "invalid", reason: "not_track" });
  });
});

/** A fetch that answers each URL from a table, and records what it was asked. */
function hops(table: Record<string, { status: number; location?: string }>) {
  const asked: string[] = [];
  const fetchImpl = jest.fn(async (url: string, init?: RequestInit) => {
    asked.push(url);
    expect(init?.redirect).toBe("manual");
    const hop = table[url];
    if (!hop) throw new Error(`unexpected fetch ${url}`);
    return new Response(null, { status: hop.status, headers: hop.location ? { location: hop.location } : {} });
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, asked };
}

describe("resolveSpotifyLink", () => {
  it("answers a track link without any request", async () => {
    const { fetchImpl, asked } = hops({});
    expect(await resolveSpotifyLink(`${TRACK}?si=1`, { fetchImpl })).toEqual({ ok: true, trackId: ID, url: TRACK });
    expect(asked).toEqual([]);
  });

  it("follows spotify.link to spotify.app.link to the track, and stops without fetching open.spotify.com", async () => {
    const { fetchImpl, asked } = hops({
      "https://spotify.link/AbCdEf123": { status: 307, location: "https://spotify.app.link/AbCdEf123?_p=c1" },
      "https://spotify.app.link/AbCdEf123?_p=c1": { status: 307, location: `https://open.spotify.com/track/${ID}?si=z&_branch_match_id=9` },
    });
    expect(await resolveSpotifyLink("https://spotify.link/AbCdEf123", { fetchImpl })).toEqual({ ok: true, trackId: ID, url: TRACK });
    expect(asked).toEqual(["https://spotify.link/AbCdEf123", "https://spotify.app.link/AbCdEf123?_p=c1"]);
  });

  it("names an album the short link leads to as an album", async () => {
    const { fetchImpl } = hops({
      "https://spotify.link/Alb": { status: 302, location: `https://open.spotify.com/album/${ID}` },
    });
    expect(await resolveSpotifyLink("https://spotify.link/Alb", { fetchImpl })).toMatchObject({
      ok: false,
      reason: "album",
      message: "That's an album link. Open the song and copy its link.",
    });
  });

  it("never fetches a host outside Spotify's three, wherever a redirect points", async () => {
    const { fetchImpl, asked } = hops({
      "https://spotify.link/Evil": { status: 302, location: "http://169.254.169.254/latest/meta-data" },
    });
    expect(await resolveSpotifyLink("https://spotify.link/Evil", { fetchImpl })).toMatchObject({ ok: false, reason: "short_link_unresolvable" });
    expect(asked).toEqual(["https://spotify.link/Evil"]);
  });

  it("refuses a plain-http hop even on a Spotify host", async () => {
    const { fetchImpl, asked } = hops({
      "https://spotify.link/Down": { status: 302, location: "http://spotify.app.link/Down" },
    });
    expect(await resolveSpotifyLink("https://spotify.link/Down", { fetchImpl })).toMatchObject({ ok: false });
    expect(asked).toHaveLength(1);
  });

  it("gives up after five hops", async () => {
    const table: Record<string, { status: number; location: string }> = {};
    for (let i = 0; i < 10; i++) table[`https://spotify.link/L${i}`] = { status: 302, location: `https://spotify.link/L${i + 1}` };
    const { fetchImpl, asked } = hops(table);
    expect(await resolveSpotifyLink("https://spotify.link/L0", { fetchImpl })).toMatchObject({ ok: false, reason: "short_link_unresolvable" });
    expect(asked).toHaveLength(5);
  });

  it("gives up on an answer with no redirect, or a request that fails", async () => {
    const { fetchImpl } = hops({ "https://spotify.link/Html": { status: 200 } });
    expect(await resolveSpotifyLink("https://spotify.link/Html", { fetchImpl })).toMatchObject({ ok: false });
    const failing = jest.fn(async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await resolveSpotifyLink("https://spotify.link/Any", { fetchImpl: failing })).toMatchObject({
      ok: false,
      message: SPOTIFY_LINK_ERRORS.short_link_unresolvable,
    });
  });

  it("spends one time budget across every hop, not one per hop", async () => {
    /* Each hop takes 40 ms and redirects to the next. A per-hop limit of 100 ms
       would let all five through; one budget of 100 ms for the walk stops it
       on the third. */
    const asked: string[] = [];
    const slow = jest.fn(
      (url: string, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          asked.push(url);
          const timer = setTimeout(() => {
            const n = Number(url.split("/L")[1]);
            resolve(new Response(null, { status: 302, headers: { location: `https://spotify.link/L${n + 1}` } }));
          }, 40);
          init?.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          });
        })
    ) as unknown as typeof fetch;
    expect(await resolveSpotifyLink("https://spotify.link/L0", { fetchImpl: slow, budgetMs: 100 })).toMatchObject({ ok: false });
    expect(asked.length).toBeGreaterThanOrEqual(2);
    expect(asked.length).toBeLessThan(5);
  });
});

describe("checkSpotifyTrack", () => {
  const answer = (status: number, body?: unknown) =>
    jest.fn(async () => new Response(body === undefined ? null : JSON.stringify(body), { status })) as unknown as typeof fetch & jest.Mock;

  it("asks Spotify's oEmbed about the track URL, and returns its title and cover", async () => {
    const fetchImpl = answer(200, { title: "Thriller", thumbnail_url: "https://image-cdn-ak.spotifycdn.com/image/ab67" });
    expect(await checkSpotifyTrack(TRACK, { fetchImpl })).toEqual({
      ok: true,
      title: "Thriller",
      thumbnailUrl: "https://image-cdn-ak.spotifycdn.com/image/ab67",
    });
    expect(fetchImpl.mock.calls[0][0]).toBe(`https://open.spotify.com/oembed?url=${encodeURIComponent(TRACK)}`);
  });

  it("keeps no cover that is not https", async () => {
    const fetchImpl = answer(200, { title: "Thriller", thumbnail_url: "javascript:alert(1)" });
    expect(await checkSpotifyTrack(TRACK, { fetchImpl })).toEqual({ ok: true, title: "Thriller", thumbnailUrl: null });
  });

  it("reads 404 and 400 as no such track, anything else as no answer", async () => {
    expect(await checkSpotifyTrack(TRACK, { fetchImpl: answer(404) })).toEqual({ ok: false, status: 404 });
    expect(await checkSpotifyTrack(TRACK, { fetchImpl: answer(400) })).toEqual({ ok: false, status: 404 });
    expect(await checkSpotifyTrack(TRACK, { fetchImpl: answer(503) })).toEqual({ ok: false, status: 502 });
    const failing = jest.fn(async () => {
      throw new Error("timeout");
    }) as unknown as typeof fetch;
    expect(await checkSpotifyTrack(TRACK, { fetchImpl: failing })).toEqual({ ok: false, status: 502 });
  });
});
