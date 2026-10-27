/**
 * @jest-environment node
 *
 * GET /api/songs/spotify-check: what the Spotify field shows under itself
 * before anything is saved. It stores nothing, answers only a signed-in
 * caller, and is never cached -- a link checked a minute ago may have been
 * pasted wrong.
 */
import { NextRequest } from "next/server";

jest.mock("@/lib/authenticate", () => ({ authenticateRequest: jest.fn() }));
jest.mock("@/lib/db", () => ({ db: new Proxy({}, { get: () => { throw new Error("the check must not touch the database"); } }) }));

import { GET } from "@/app/api/songs/spotify-check/route";
import { authenticateRequest } from "@/lib/authenticate";

const ID = "4uLU6hMCjMI75M1A2tKUQC";
const TRACK = `https://open.spotify.com/track/${ID}`;
const req = (url?: string) =>
  new NextRequest(`http://localhost/api/songs/spotify-check${url === undefined ? "" : `?url=${encodeURIComponent(url)}`}`);

const fetchMock = jest.fn();
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = fetchMock as unknown as typeof fetch;
  (authenticateRequest as jest.Mock).mockResolvedValue({ orgId: "org-1", userId: "u1", role: "OWNER" });
});

async function call(url?: string) {
  const res = await GET(req(url));
  expect(res.headers.get("cache-control")).toBe("no-store");
  return { status: res.status, body: await res.json() };
}

it("answers 401 without a session, and asks Spotify nothing", async () => {
  (authenticateRequest as jest.Mock).mockResolvedValue(null);
  expect((await call(TRACK)).status).toBe(401);
  expect(fetchMock).not.toHaveBeenCalled();
});

it("confirms a track with Spotify and returns its id, canonical link, title and cover", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ title: "Thriller", thumbnail_url: "https://i.scdn.co/image/ab67" }), { status: 200 }));
  expect(await call(`${TRACK}?si=abc`)).toEqual({
    status: 200,
    body: { trackId: ID, url: TRACK, title: "Thriller", thumbnailUrl: "https://i.scdn.co/image/ab67" },
  });
  expect(String(fetchMock.mock.calls[0][0])).toBe(`https://open.spotify.com/oembed?url=${encodeURIComponent(TRACK)}`);
});

it("refuses an album link itself, before Spotify (whose oEmbed would answer for it) is asked", async () => {
  expect(await call(`https://open.spotify.com/album/${ID}`)).toEqual({
    status: 400,
    body: { error: "album", message: "That's an album link. Open the song and copy its link." },
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

it("refuses anything that is not a Spotify link, and an empty one", async () => {
  expect(await call("https://example.com/x")).toEqual({
    status: 400,
    body: { error: "not_track", message: "That isn't a Spotify track link." },
  });
  expect((await call()).status).toBe(400);
});

it("answers 404 when Spotify has no such track, and 502 when Spotify does not answer", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));
  expect(await call(TRACK)).toEqual({ status: 404, body: { error: "not_found", message: "Spotify has no track at that link." } });
  fetchMock.mockRejectedValueOnce(new Error("timeout"));
  expect(await call(TRACK)).toMatchObject({ status: 502, body: { error: "spotify_unavailable" } });
});

it("follows a short link to the track before asking Spotify about it", async () => {
  fetchMock
    .mockResolvedValueOnce(new Response(null, { status: 307, headers: { location: `${TRACK}?si=1` } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ title: "Thriller" }), { status: 200 }));
  expect(await call("https://spotify.link/AbC123")).toEqual({
    status: 200,
    body: { trackId: ID, url: TRACK, title: "Thriller", thumbnailUrl: null },
  });
  expect(String(fetchMock.mock.calls[0][0])).toBe("https://spotify.link/AbC123");
});
