import {
  createSpotifyReader,
  type SpotifyReader,
  type SpotifyTrackHit,
  type SpotifyTrackReading,
} from "@/lib/platforms/spotifyWeb";

/**
 * The one seam every Spotify play count passes through.
 *
 * The daily cron and the first reading after a link is saved both open a
 * session here and call `readSpotifyTrack`; nothing else in the app asks
 * Spotify for a count. Today the session drives the anonymous web player
 * (lib/platforms/spotifyWeb). A reader that is signed in -- a dedicated
 * account kept logged in on the fetcher servers -- replaces or goes in front
 * of it HERE, in `readSpotifyTrack`, and every caller follows.
 *
 * Search is its own function, `searchSpotifyTracks`, so the two can move
 * separately: a song with a linked track never searches at all.
 *
 * Whatever reads it, a count of 0 is Spotify hiding the number, never a
 * measured "nobody played it". getTrack answers playcount "0" for a track
 * whose public page shows no count (two of eight songs checked, measured
 * 2026-10-25), and storing that as 0 would turn the day Spotify starts
 * publishing into one day carrying every play to date. So the rule is applied
 * in this seam, after the reader, not inside any one reader.
 */

export type SpotifyPlayCountReading = SpotifyTrackReading & {
  /** Spotify answered for the track but published no count (it said 0). */
  countHidden: boolean;
};

export type SpotifyReads = {
  readSpotifyTrack: (trackId: string) => Promise<SpotifyPlayCountReading | null>;
  searchSpotifyTracks: (query: string) => Promise<SpotifyTrackHit[]>;
  close: () => Promise<void>;
};

/** A count of 0 is a hidden count: no number, and said so. */
export function withPublishedCount(reading: SpotifyTrackReading | null): SpotifyPlayCountReading | null {
  if (!reading) return null;
  const hidden = reading.playCount === 0;
  return { ...reading, playCount: hidden ? null : reading.playCount, countHidden: hidden };
}

/**
 * One session per run: the reader keeps one browser for all of a run's reads
 * and is closed by the caller. `reader` is for tests and for a caller that
 * already holds one.
 */
export function openSpotifyReads(opts: { reader?: SpotifyReader } = {}): SpotifyReads {
  const reader = opts.reader ?? createSpotifyReader();
  return {
    async readSpotifyTrack(trackId) {
      return withPublishedCount(await reader.track(trackId));
    },
    async searchSpotifyTracks(query) {
      return reader.search(query);
    },
    async close() {
      await reader.close();
    },
  };
}
