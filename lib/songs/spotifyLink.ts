/**
 * A pasted Spotify link, read as the one thing it may be: a track.
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
 * An album, playlist, artist or podcast link is refused with what it is,
 * because "the song is on this album" is the likeliest wrong paste and the fix
 * is one tap away. Spotify's own oEmbed answers for an album link too, so this
 * parser, not Spotify, decides that a link is a track.
 */

export type SpotifyLinkReason =
  | "album"
  | "playlist"
  | "artist"
  | "episode"
  | "show"
  | "not_track"
  | "short_link_unresolvable";

export const SPOTIFY_LINK_ERRORS: Record<SpotifyLinkReason, string> = {
  album: "That's an album link. Open the song and copy its link.",
  playlist: "That's a playlist link. Open the song and copy its link.",
  artist: "That's an artist link. Open the song and copy its link.",
  episode: "That's a podcast episode link. Open the song and copy its link.",
  show: "That's a podcast link. Open the song and copy its link.",
  not_track: "That isn't a Spotify track link.",
  short_link_unresolvable: "That short link didn't lead to a Spotify track. Open the song in Spotify and copy its link.",
};

export type SpotifyLinkParse =
  | { kind: "track"; trackId: string; url: string }
  | { kind: "short-link"; url: string }
  | { kind: "invalid"; reason: SpotifyLinkReason };

const TRACK_ID = /^[A-Za-z0-9]{22}$/;
const OTHER_KINDS = new Set(["album", "playlist", "artist", "episode", "show"]);
export const SPOTIFY_SHORT_HOSTS = new Set(["spotify.link", "spotify.app.link"]);
export const SPOTIFY_OPEN_HOST = "open.spotify.com";
/* intl-de, intl-pt, intl-ja: the regional prefix Spotify adds to a page's path. */
const INTL_SEGMENT = /^intl-[a-z]{2}(?:-[a-z]{2,4})?$/i;

export function spotifyTrackLink(trackId: string): string {
  return `https://${SPOTIFY_OPEN_HOST}/track/${trackId}`;
}

function byKind(kind: string, id: string | undefined): SpotifyLinkParse {
  const k = kind.toLowerCase();
  if (k === "track") {
    return id && TRACK_ID.test(id)
      ? { kind: "track", trackId: id, url: spotifyTrackLink(id) }
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
