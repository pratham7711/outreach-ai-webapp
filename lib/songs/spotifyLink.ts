/**
 * A pasted Spotify link, read as one of the two things it may be: a track, or
 * an album (an album, EP or single page) whose tracks are all counted.
 *
 * Pure and dependency-free, so the New Campaign form and Settings run the
 * same parser the server does and name a wrong link before any request is
 * made. Following a short link needs the network and lives server-side
 * (lib/songs/spotifyLinkResolve.ts).
 *
 * Accepted, all naming the same track:
 *   https://open.spotify.com/track/<id>
 *   https://open.spotify.com/intl-de/track/<id>?si=...   (a regional page)
 *   https://open.spotify.com/embed/track/<id>            (an embed's src)
 *   spotify:track:<id>                                   (Copy Spotify URI)
 * and, to be followed first, https://spotify.link/... and
 * https://spotify.app.link/..., which is what the app's Share button copies.
 *
 * and the same shapes with /album/<id>, for a release whose versions (slowed,
 * sped up, reverb) sit on one album: the daily read adds up every track on it.
 *
 * A playlist, artist or podcast link is refused with what it is. Spotify's own
 * oEmbed answers for those too, so this parser, not Spotify, decides what a
 * link is.
 */

export type SpotifyLinkReason =
  | "playlist"
  | "artist"
  | "episode"
  | "show"
  | "not_track"
  | "short_link_unresolvable";

export const SPOTIFY_LINK_ERRORS: Record<SpotifyLinkReason, string> = {
  playlist: "That's a playlist link. Open the song and copy its link.",
  artist: "That's an artist link. Open the song and copy its link.",
  episode: "That's a podcast episode link. Open the song and copy its link.",
  show: "That's a podcast link. Open the song and copy its link.",
  not_track: "That isn't a Spotify track or album link.",
  short_link_unresolvable: "That short link didn't lead to a Spotify track or album. Open it in Spotify and copy its link.",
};

/** What a saved link points at: one track, or every track on an album. */
export type SpotifyRef = { kind: "track"; id: string } | { kind: "album"; id: string };

export type SpotifyLinkParse =
  | { kind: "track"; trackId: string; url: string }
  | { kind: "album"; albumId: string; url: string }
  | { kind: "short-link"; url: string }
  | { kind: "invalid"; reason: SpotifyLinkReason };

const TRACK_ID = /^[A-Za-z0-9]{22}$/;
const OTHER_KINDS = new Set(["playlist", "artist", "episode", "show"]);
export const SPOTIFY_SHORT_HOSTS = new Set(["spotify.link", "spotify.app.link"]);
export const SPOTIFY_OPEN_HOST = "open.spotify.com";
/* intl-de, intl-pt, intl-ja: the regional prefix Spotify adds to a page's path. */
const INTL_SEGMENT = /^intl-[a-z]{2}(?:-[a-z]{2,4})?$/i;

export function spotifyTrackLink(trackId: string): string {
  return `https://${SPOTIFY_OPEN_HOST}/track/${trackId}`;
}

export function spotifyAlbumLink(albumId: string): string {
  return `https://${SPOTIFY_OPEN_HOST}/album/${albumId}`;
}

export function spotifyRefLink(ref: SpotifyRef): string {
  return ref.kind === "album" ? spotifyAlbumLink(ref.id) : spotifyTrackLink(ref.id);
}

/** The ref a parse names, or null for a short link (only the server can follow it) or an invalid one. */
export function spotifyRefOf(parsed: SpotifyLinkParse): SpotifyRef | null {
  if (parsed.kind === "track") return { kind: "track", id: parsed.trackId };
  if (parsed.kind === "album") return { kind: "album", id: parsed.albumId };
  return null;
}

function byKind(kind: string, id: string | undefined): SpotifyLinkParse {
  const k = kind.toLowerCase();
  if (k === "track") {
    return id && TRACK_ID.test(id)
      ? { kind: "track", trackId: id, url: spotifyTrackLink(id) }
      : { kind: "invalid", reason: "not_track" };
  }
  if (k === "album") {
    return id && TRACK_ID.test(id)
      ? { kind: "album", albumId: id, url: spotifyAlbumLink(id) }
      : { kind: "invalid", reason: "not_track" };
  }
  return { kind: "invalid", reason: OTHER_KINDS.has(k) ? (k as SpotifyLinkReason) : "not_track" };
}

export function parseSpotifyLink(raw: string): SpotifyLinkParse {
  const text = raw.trim();
  if (!text) return { kind: "invalid", reason: "not_track" };

  /* spotify:track:<id>, and the old spotify:user:<name>:playlist:<id>, whose
     kind is the second-last part. */
  if (/^spotify:/i.test(text)) {
    const parts = text.split(":");
    if (parts.length < 3) return { kind: "invalid", reason: "not_track" };
    return byKind(parts[parts.length - 2], parts[parts.length - 1]);
  }

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { kind: "invalid", reason: "not_track" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { kind: "invalid", reason: "not_track" };
  const host = url.hostname.toLowerCase();

  if (SPOTIFY_SHORT_HOSTS.has(host)) {
    /* Always fetched over https, whatever was pasted: the code in the path is
       the whole link, and the host is one of two names we chose. */
    if (url.pathname.replace(/\//g, "") === "") return { kind: "invalid", reason: "not_track" };
    return { kind: "short-link", url: `https://${host}${url.pathname}${url.search}` };
  }
  if (host !== SPOTIFY_OPEN_HOST) return { kind: "invalid", reason: "not_track" };

  const segments = url.pathname.split("/").filter(Boolean);
  while (segments.length && (INTL_SEGMENT.test(segments[0]) || segments[0].toLowerCase() === "embed")) segments.shift();
  if (segments.length < 1 || segments.length > 2) return { kind: "invalid", reason: "not_track" };
  return byKind(segments[0], segments[1]);
}
