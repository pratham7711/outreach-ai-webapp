import {
  SPOTIFY_LINK_ERRORS,
  SPOTIFY_OPEN_HOST,
  SPOTIFY_SHORT_HOSTS,
  parseSpotifyLink,
  type SpotifyLinkReason,
} from "./spotifyLink";

/**
 * The server's half of a pasted Spotify link: following a short one, and
 * asking Spotify whether the track exists.
 *
 * Both run before anything is stored, and neither is the play count -- that is
 * still read once a day by the cron (lib/songs/streamSnapshot.ts).
 */

type Fetch = typeof fetch;

export type SpotifyLinkResolution =
  | { ok: true; trackId: string; url: string }
  | { ok: false; reason: SpotifyLinkReason; message: string };

const MAX_HOPS = 5;
const RESOLVE_BUDGET_MS = 5_000;
const FOLLOWABLE = new Set([...SPOTIFY_SHORT_HOSTS, SPOTIFY_OPEN_HOST]);

const refuse = (reason: SpotifyLinkReason): SpotifyLinkResolution => ({
  ok: false,
  reason,
  message: SPOTIFY_LINK_ERRORS[reason],
});

/**
 * A pasted link to the track it names.
 *
 * spotify.link and spotify.app.link carry an opaque code, so the only way to
 * learn the track is to ask where the link goes. Redirects are followed by
 * hand, at most five hops inside five seconds altogether, and every hop is
 * re-checked against the three Spotify hosts before it is fetched: an open
 * redirect on a shortener would otherwise make this a request forgery
 * primitive pointed anywhere (same guard as lib/trackers/expandShortLink).
 * Arriving on open.spotify.com ends the walk without fetching it -- the
 * address alone says which track it is.
 */
export async function resolveSpotifyLink(
  raw: string,
  opts: { fetchImpl?: Fetch; budgetMs?: number } = {}
): Promise<SpotifyLinkResolution> {
  const parsed = parseSpotifyLink(raw);
  if (parsed.kind === "track") return { ok: true, trackId: parsed.trackId, url: parsed.url };
  if (parsed.kind === "invalid") return refuse(parsed.reason);

  const fetchImpl = opts.fetchImpl ?? fetch;
  const signal = AbortSignal.timeout(opts.budgetMs ?? RESOLVE_BUDGET_MS);
  let current = parsed.url;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    let res: Response;
    try {
      res = await fetchImpl(current, { method: "GET", redirect: "manual", signal });
    } catch {
      return refuse("short_link_unresolvable");
    }
    // Only the Location header is wanted; the body is never read.
    await res.body?.cancel().catch(() => {});
    const location = res.status >= 300 && res.status < 400 ? res.headers.get("location") : null;
    if (!location) return refuse("short_link_unresolvable");

    let next: URL;
    try {
      next = new URL(location, current);
    } catch {
      return refuse("short_link_unresolvable");
    }
    const host = next.hostname.toLowerCase();
    if (next.protocol !== "https:" || !FOLLOWABLE.has(host)) return refuse("short_link_unresolvable");
    if (host === SPOTIFY_OPEN_HOST) {
      const landed = parseSpotifyLink(next.toString());
      if (landed.kind === "track") return { ok: true, trackId: landed.trackId, url: landed.url };
      return refuse(landed.kind === "invalid" ? landed.reason : "short_link_unresolvable");
    }
    current = next.toString();
  }
  return refuse("short_link_unresolvable");
}

export type SpotifyTrackCheck =
  | { ok: true; title: string | null; thumbnailUrl: string | null }
  | { ok: false; status: 404 | 502 };

const OEMBED_TIMEOUT_MS = 5_000;

/**
 * Whether Spotify has this track, from its public oEmbed endpoint: one small
 * JSON answer with the track's title and cover (measured 2026-10-25 at about
 * 0.3 s). It answers for an album link too, which is why the link is parsed as
 * a track first and this only ever sees a track URL.
 *
 * 404 means Spotify said there is no such track (a 400 is the same answer for
 * an id it cannot read); 502 means it did not answer, which is not evidence
 * either way.
 */
export async function checkSpotifyTrack(
  trackUrl: string,
  opts: { fetchImpl?: Fetch; timeoutMs?: number } = {}
): Promise<SpotifyTrackCheck> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`https://${SPOTIFY_OPEN_HOST}/oembed?url=${encodeURIComponent(trackUrl)}`, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? OEMBED_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch {
    return { ok: false, status: 502 };
  }
  if (res.status === 404 || res.status === 400) return { ok: false, status: 404 };
  if (!res.ok) return { ok: false, status: 502 };
  const body = (await res.json().catch(() => null)) as { title?: unknown; thumbnail_url?: unknown } | null;
  if (!body) return { ok: false, status: 502 };
  const title = typeof body.title === "string" && body.title.trim() ? body.title.trim() : null;
  const thumb = typeof body.thumbnail_url === "string" && /^https:\/\//i.test(body.thumbnail_url) ? body.thumbnail_url : null;
  return { ok: true, title, thumbnailUrl: thumb };
}
