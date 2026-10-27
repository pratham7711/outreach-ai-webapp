import type { SpotifyTrackHit } from "@/lib/platforms/spotifyWeb";

/**
 * Which Spotify track a song is, decided without asking anyone.
 *
 * The song's own fields are what there is: an ISRC when one was entered, a
 * title, and an artist -- and on production the artist is usually blank (14 of
 * the 16 songs, measured 2026-10-14), with the artist living on the TikTok
 * sound the song is promoted with instead. So the artist is the song's when it
 * has one, otherwise its sound's.
 *
 * A search result is accepted only when its title is the song's title exactly
 * (case, accents, punctuation and a "(feat. ...)" tail aside) AND one of its
 * artists is the song's artist -- exactly, or one name contained in the other
 * when the shorter is at least 4 letters. The containment is for the TikTok
 * account names that carry a suffix the Spotify artist does not ("<name>
 * official", "<name>music"): on the 16 production songs it took matches from
 * 4 to 10. Under 4 letters it would accept a stranger whose name happens to sit
 * inside another's, so it does not apply there.
 *
 * A title written "<artist> - <title>" (production has "Michael Jackson -
 * Thriller") is also tried split: when the left part is one of the result's
 * artists under the same rules, the right part is compared as the title. The
 * left part is then the artist check, so this is still never a match on title
 * alone.
 *
 * Nothing is matched on title alone: a common title has dozens of tracks, and
 * a wrong match would put another artist's streams on a brand's report.
 */

export type SongForMatch = {
  title: string;
  artist: string | null;
  isrc: string | null;
  soundArtist: string | null;
};

export type SpotifyMatch = { hit: SpotifyTrackHit; how: "artist-exact" | "artist-contained" };

const MIN_CONTAINED = 4;

/**
 * Case, Latin accents, punctuation and a featured-artist tail removed. Letters
 * and their marks in any other script are kept and recomposed, so a Hindi
 * vowel sign or a Hangul syllable survives intact.
 */
export function squash(s: string | null | undefined): string {
  return (s ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/\s*[([][^)\]]*\b(feat|ft|with)\b\.?[^)\]]*[)\]]/g, "")
    .replace(/\s+(feat|ft)\.?\s.*$/, "")
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
}

/** "A & B", "A, B", "A x B": the whole string and each artist on its own, squashed. */
export function splitArtists(s: string | null | undefined): string[] {
  const parts = (s ?? "")
    .split(/\s*(?:,|&|\+|\/|\band\b|\bx\b|\bwith\b|\bfeat\.?|\bft\.?)\s*/i)
    .map(squash)
    .filter(Boolean);
  return [...new Set([squash(s), ...parts].filter(Boolean))];
}

export function songArtist(song: SongForMatch): string {
  return (song.artist ?? "").trim() || (song.soundArtist ?? "").trim();
}

/**
 * "Michael Jackson - Thriller" as { artist, title }, or null. Split at the
 * first spaced hyphen or dash only, so "Artist - Title - Live" keeps its
 * second half as the title, and "Jay-Z" (no spaces) is never split.
 */
export function splitArtistTitle(title: string): { artist: string; title: string } | null {
  const m = /^(.+?)\s+[-\u2013\u2014]\s+(.+)$/.exec(title.trim());
  if (!m) return null;
  const [, artist, rest] = m;
  return squash(artist) && squash(rest) ? { artist: artist.trim(), title: rest.trim() } : null;
}

/** What to type into Spotify's search, best first. Empty when there is nothing to search with. */
export function searchQueries(song: SongForMatch): string[] {
  const out: string[] = [];
  const isrc = (song.isrc ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(isrc)) out.push(`isrc:${isrc}`);
  const title = song.title.trim();
  if (title) out.push(`${title} ${songArtist(song)}`.trim());
  /* The split title on its own, last: the sound's artist appended above can
     be a TikTok account name that drowns the two words that matter. */
  const split = splitArtistTitle(title);
  if (split) {
    const q = `${split.title} ${split.artist}`;
    if (!out.includes(q)) out.push(q);
  }
  return out;
}

function artistFit(want: string[], have: string[]): SpotifyMatch["how"] | null {
  if (!want.length || !have.length) return null;
  if (want.some((w) => have.includes(w))) return "artist-exact";
  const contained = want.some((w) =>
    have.some((h) => {
      const [short, long] = w.length <= h.length ? [w, h] : [h, w];
      return short.length >= MIN_CONTAINED && long.includes(short);
    })
  );
  return contained ? "artist-contained" : null;
}

/**
 * The track to read for this song, or null. An exact artist beats a contained
 * one; between equals, Spotify's own order (its most relevant first) decides.
 */
export function pickSpotifyTrack(song: SongForMatch, hits: readonly SpotifyTrackHit[]): SpotifyMatch | null {
  const title = squash(song.title);
  const want = splitArtists(songArtist(song));
  const split = splitArtistTitle(song.title);
  const splitTitle = split ? squash(split.title) : "";
  const splitWant = split ? splitArtists(split.artist) : [];
  if (!title || (!want.length && !splitWant.length)) return null;
  let contained: SpotifyMatch | null = null;
  for (const hit of hits) {
    const name = squash(hit.name);
    const have = hit.artists.map(squash).filter(Boolean);
    /* The whole title against the song's artist; failing that, the split
       title against the artist written into it. Either way an artist fits. */
    const how =
      (name === title ? artistFit(want, have) : null) ?? (split && name === splitTitle ? artistFit(splitWant, have) : null);
    if (how === "artist-exact") return { hit, how };
    if (how === "artist-contained" && !contained) contained = { hit, how };
  }
  return contained;
}
