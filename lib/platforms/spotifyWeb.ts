import { createBrowserSession, withTimeout, type BrowserSession, type LaunchedBrowser } from "@/lib/platforms/tiktokBrowser";

/**
 * Spotify's public track page, read the way a logged-out visitor's browser
 * reads it.
 *
 * Spotify publishes no play count in its Web API. Its web player shows one on
 * every public track page, and gets it from its own GraphQL endpoint
 * (api-partner.spotify.com/pathfinder) with an anonymous token the page mints
 * for itself. A plain fetch of the page carries no count (measured 2026-10-14:
 * none of the page's five embedded scripts holds one), and the token needs the
 * page's own JavaScript, so this drives the page in the same headless Chromium
 * the TikTok readers use and listens for the answer the page asks for.
 *
 * Measured from this Mac on 2026-10-14, logged out, no Spotify account:
 * getTrack answered "playcount": "5631276067" for a public track, and a search
 * page answered searchTracks with 20 tracks. Not yet measured from Vercel.
 *
 * Read-only and anonymous: no login, no cookie carried between runs, no
 * Spotify account of anyone's. Images, media and fonts are refused, so a read
 * is the page's scripts and its data calls, not its pictures or audio.
 */

export type SpotifyTrackHit = { id: string; name: string; artists: string[] };

export type SpotifyTrackReading = SpotifyTrackHit & { playCount: number | null };

export type SpotifyAsk = { kind: "search"; query: string } | { kind: "track"; trackId: string };

type Answer = { status: number; json: unknown };

const TRACK_ID = /^[A-Za-z0-9]{22}$/;

export function isSpotifyTrackId(id: string): boolean {
  return TRACK_ID.test(id);
}

export function spotifyTrackUrl(trackId: string): string {
  return `https://open.spotify.com/track/${trackId}`;
}

function names(list: unknown): string[] {
  const items = (list as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((a) => (a as { profile?: { name?: unknown } })?.profile?.name)
    .filter((n): n is string => typeof n === "string" && n.length > 0);
}

/** The tracks a searchTracks answer lists, in Spotify's own order. */
export function parseSearchTracks(json: unknown): SpotifyTrackHit[] {
  const items = (json as { data?: { searchV2?: { tracksV2?: { items?: unknown[] } } } })?.data?.searchV2?.tracksV2?.items;
  if (!Array.isArray(items)) return [];
  const out: SpotifyTrackHit[] = [];
  for (const entry of items) {
    const d = (entry as { item?: { data?: Record<string, unknown> } })?.item?.data;
    if (!d || typeof d.id !== "string" || !isSpotifyTrackId(d.id) || typeof d.name !== "string") continue;
    out.push({ id: d.id, name: d.name, artists: names(d.artists) });
  }
  return out;
}

/**
 * A getTrack answer. The count arrives as a string ("5631276067"); anything
 * that is not a whole non-negative number is null, never 0, because 0 would
 * read as a measured "nobody played it".
 */
export function parseTrack(json: unknown): SpotifyTrackReading | null {
  const t = (json as { data?: { trackUnion?: Record<string, unknown> } })?.data?.trackUnion;
  if (!t || typeof t.id !== "string" || !isSpotifyTrackId(t.id) || typeof t.name !== "string") return null;
  const raw = t.playcount;
  const n = typeof raw === "string" && /^\d+$/.test(raw) ? Number(raw) : typeof raw === "number" ? raw : NaN;
  return {
    id: t.id,
    name: t.name,
    artists: [...names(t.firstArtist), ...names(t.otherArtists)],
    playCount: Number.isSafeInteger(n) && n >= 0 ? n : null,
  };
}

const BLOCKED = new Set(["image", "media", "font"]);

function pageUrl(ask: SpotifyAsk): string {
  return ask.kind === "track"
    ? spotifyTrackUrl(ask.trackId)
    : `https://open.spotify.com/search/${encodeURIComponent(ask.query)}/tracks`;
}

type PageRoute = { request: () => { resourceType: () => string }; abort: () => Promise<void>; continue: () => Promise<void> };
type PageResponse = {
  url: () => string;
  status: () => number;
  request: () => { postData: () => string | null };
  json: () => Promise<unknown>;
};

/**
 * Opens the page, waits for the one data call it is there for, and closes it.
 * For a track, the answer must be about that track: the page also asks about
 * other tracks (recommendations), and those are not this song's count.
 */
async function readOnce(browser: LaunchedBrowser, ask: SpotifyAsk, timeoutMs: number): Promise<Answer | null> {
  const page = await browser.newPage({ locale: "en-US", viewport: { width: 1280, height: 800 } });
  try {
    await page.route("**/*", (route: PageRoute) =>
      BLOCKED.has(route.request().resourceType()) ? route.abort() : route.continue()
    );
    const wanted = ask.kind === "track" ? "getTrack" : "searchTracks";
    const answer = new Promise<Answer>((resolve) => {
      page.on("response", async (res: PageResponse) => {
        if (!String(res.url()).includes("/pathfinder/")) return;
        let body: { operationName?: string; variables?: { uri?: string } } = {};
        try {
          body = JSON.parse(res.request().postData() ?? "{}");
        } catch {
          return;
        }
        if (body.operationName !== wanted) return;
        if (ask.kind === "track" && body.variables?.uri !== `spotify:track:${ask.trackId}`) return;
        resolve({ status: res.status(), json: await res.json().catch(() => null) });
      });
    });
    await page.goto(pageUrl(ask), { waitUntil: "domcontentloaded", timeout: timeoutMs });
    return await withTimeout(answer, timeoutMs, `spotify ${wanted}`);
  } finally {
    await page.close().catch(() => {});
  }
}

export type SpotifyReader = {
  search: (query: string) => Promise<SpotifyTrackHit[]>;
  track: (trackId: string) => Promise<SpotifyTrackReading | null>;
  close: () => Promise<void>;
};

/**
 * One browser for a whole run, launched on the first read. A read that does
 * not get its answer throws, with the reason, so the caller can record it.
 */
export function createSpotifyReader(opts: { timeoutMs?: number } = {}): SpotifyReader {
  const session: BrowserSession<SpotifyAsk, Answer> = createBrowserSession(readOnce, {
    defaultTimeoutMs: opts.timeoutMs ?? 30_000,
    hardCapMs: 60_000,
    stopWhenExhausted: true,
  });
  const ask = async (a: SpotifyAsk): Promise<Answer> => {
    const got = await session.read(a);
    if (!got) throw new Error("spotify: browser unavailable");
    if (got.status !== 200) throw new Error(`spotify: answered ${got.status}`);
    return got;
  };
  return {
    async search(query) {
      return parseSearchTracks((await ask({ kind: "search", query })).json);
    },
    async track(trackId) {
      if (!isSpotifyTrackId(trackId)) return null;
      return parseTrack((await ask({ kind: "track", trackId })).json);
    },
    close: () => session.close(),
  };
}
