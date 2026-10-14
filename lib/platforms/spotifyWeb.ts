import { launch, withTimeout, type LaunchedBrowser } from "@/lib/platforms/tiktokBrowser";

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
 * page answered searchTracks with 20 tracks.
 *
 * One page per run, navigated from read to read. The TikTok readers' session
 * (lib/platforms/tiktokBrowser) keeps a never-navigated keeper page in a
 * second browser context, and with that page open the production Chromium
 * (--single-process) died with SIGTRAP on Spotify's web player, 1.5s into the
 * first read, right after its token calls: 4 runs of 4 in a 1-vCPU sin1
 * Sandbox, 2026-10-14, and 3 of 3 production dry-run reads timing out the same
 * day. The same build reusing one page answered 3 reads of 3 there and exited
 * cleanly. Keeping that page open also keeps the page count above zero, which
 * is what the keeper page is for.
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
type OnResponse = (res: PageResponse) => void;
type SpotifyPage = {
  route: (url: string, handler: (route: PageRoute) => Promise<void>) => Promise<void>;
  on: (event: "response", fn: OnResponse) => unknown;
  off: (event: "response", fn: OnResponse) => unknown;
  goto: (url: string, opts: { waitUntil: "domcontentloaded"; timeout: number }) => Promise<unknown>;
};

/** Whether a pathfinder call is the answer this read is waiting for. */
export function answersAsk(ask: SpotifyAsk, body: { operationName?: unknown; variables?: Record<string, unknown> }): boolean {
  if (ask.kind === "track") return body.operationName === "getTrack" && body.variables?.uri === `spotify:track:${ask.trackId}`;
  return body.operationName === "searchTracks" && body.variables?.searchTerm === ask.query;
}

/**
 * Navigates the run's page and waits for the one data call it is there for.
 * The answer must be about this read: a track page also asks about other
 * tracks (recommendations), and on a reused page the previous search can still
 * be answering when the next one starts.
 */
async function readOnce(page: SpotifyPage, ask: SpotifyAsk, timeoutMs: number): Promise<Answer> {
  let onResponse: OnResponse = () => {};
  const answer = new Promise<Answer>((resolve) => {
    onResponse = (res) => {
      if (!String(res.url()).includes("/pathfinder/")) return;
      let body: { operationName?: unknown; variables?: Record<string, unknown> } = {};
      try {
        body = JSON.parse(res.request().postData() ?? "{}");
      } catch {
        return;
      }
      if (!answersAsk(ask, body)) return;
      void res.json().then(
        (json) => resolve({ status: res.status(), json }),
        () => resolve({ status: res.status(), json: null })
      );
    };
  });
  page.on("response", onResponse);
  try {
    await page.goto(pageUrl(ask), { waitUntil: "domcontentloaded", timeout: timeoutMs });
    return await withTimeout(answer, timeoutMs, `spotify ${ask.kind === "track" ? "getTrack" : "searchTracks"}`);
  } finally {
    page.off("response", onResponse);
  }
}

export type SpotifyReader = {
  search: (query: string) => Promise<SpotifyTrackHit[]>;
  track: (trackId: string) => Promise<SpotifyTrackReading | null>;
  close: () => Promise<void>;
};

const LAUNCH_TIMEOUT_MS = 60_000;
const READ_CAP_MS = 60_000;

/**
 * One browser and one page for a whole run, opened on the first read. A read
 * that does not get its answer throws, with the reason, so the caller can
 * record it; the browser it ran in is closed, and the next read opens a fresh
 * one rather than trusting a page that may have died. Every browser call is
 * under a timeout, because a wedged --single-process Chromium neither answers
 * nor fails (lib/platforms/tiktokBrowser, rule 2).
 */
export function createSpotifyReader(
  opts: { timeoutMs?: number; launchBrowser?: () => Promise<LaunchedBrowser> } = {}
): SpotifyReader {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const launchBrowser = opts.launchBrowser ?? launch;
  let open: Promise<{ browser: LaunchedBrowser; page: SpotifyPage }> | null = null;

  const dispose = () => {
    const dead = open;
    open = null;
    dead?.then(({ browser }) => browser.close()).catch(() => {});
  };

  const pageForRun = () => {
    if (!open) {
      const launching = launchBrowser();
      const opening = withTimeout(
        launching.then(async (browser) => {
          const page: SpotifyPage = await browser.newPage({ locale: "en-US", viewport: { width: 1280, height: 800 } });
          await page.route("**/*", (route) => (BLOCKED.has(route.request().resourceType()) ? route.abort() : route.continue()));
          return { browser, page };
        }),
        LAUNCH_TIMEOUT_MS,
        "browser launch"
      );
      opening.catch(() => {
        if (open === opening) open = null;
        launching.then((b) => b.close()).catch(() => {});
      });
      open = opening;
    }
    return open;
  };

  const ask = async (a: SpotifyAsk): Promise<Answer> => {
    let got: Answer;
    try {
      const { page } = await pageForRun();
      got = await withTimeout(readOnce(page, a, timeoutMs), READ_CAP_MS, "browser read");
    } catch (e) {
      dispose();
      throw e instanceof Error ? e : new Error(String(e));
    }
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
    async close() {
      const dead = open;
      open = null;
      if (!dead) return;
      await withTimeout(dead.then(({ browser }) => browser.close()), 10_000, "browser close").catch(() => {});
    },
  };
}
