import { after } from "next/server";
import { OPEN_CAMPAIGN_STATUSES, primeSongStreams } from "./streamSnapshot";
import { saveSongSpotifyLink, type SpotifyLinkSave } from "./songLinks";
import { saveSongAlbum, songAlbumsReady } from "./songAlbums";
import type { SpotifyRef } from "./spotifyLink";

/**
 * Saving a campaign's Spotify link, as the create and edit routes both do it:
 * store it on the campaign's song, and when that set or changed the link on an
 * open campaign, take the first reading in the background.
 *
 * A song is tracked by one track (Song.spotifyTrackId) or one album
 * (SongSpotifyAlbum), never both: setting either clears the other, and null
 * clears both. An album needs its tables; without them the save is
 * "unavailable" and nothing is changed.
 *
 * The reading goes in `after()`, so the operator's response never waits for a
 * browser; after() itself throws outside a request scope, and that must not
 * cost the caller a save that already succeeded -- the cron reads the song the
 * next morning either way. Same hand-off as the audio's first reading.
 */
export async function applySongSpotifyLink(
  orgId: string,
  songId: string,
  ref: SpotifyRef | null,
  campaignStatus: string
): Promise<SpotifyLinkSave> {
  let saved: SpotifyLinkSave;
  if (ref?.kind === "album") {
    if (!(await songAlbumsReady())) return "unavailable";
    const track = await saveSongSpotifyLink(orgId, songId, null);
    if (track === "no-song" || track === "unavailable") return track;
    const album = await saveSongAlbum(orgId, songId, ref.id);
    if (album === "unavailable") return "unavailable";
    saved = track === "changed" || album === "changed" ? "changed" : "unchanged";
  } else {
    const track = await saveSongSpotifyLink(orgId, songId, ref?.id ?? null);
    if (track === "no-song" || track === "unavailable") return track;
    /* No album tables means no album to clear. */
    const album = await saveSongAlbum(orgId, songId, null);
    saved = track === "changed" || album === "changed" ? "changed" : "unchanged";
  }

  const open = (OPEN_CAMPAIGN_STATUSES as readonly string[]).includes(campaignStatus);
  if (saved === "changed" && ref && open) {
    try {
      after(async () => {
        try {
          await primeSongStreams(orgId, songId);
        } catch (error) {
          console.error("Failed to take the song's first Spotify reading:", error);
        }
      });
    } catch (error) {
      console.error("Could not schedule the song's first Spotify reading:", error);
    }
  }
  return saved;
}
