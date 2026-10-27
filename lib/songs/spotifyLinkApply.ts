import { after } from "next/server";
import { OPEN_CAMPAIGN_STATUSES, primeSongStreams } from "./streamSnapshot";
import { saveSongSpotifyLink, type SpotifyLinkSave } from "./songLinks";

/**
 * Saving a campaign's Spotify link, as the create and edit routes both do it:
 * store it on the campaign's song, and when that set or changed the link on an
 * open campaign, take the first reading in the background.
 *
 * The reading goes in `after()`, so the operator's response never waits for a
 * browser; after() itself throws outside a request scope, and that must not
 * cost the caller a save that already succeeded -- the cron reads the song the
 * next morning either way. Same hand-off as the audio's first reading.
 */
export async function applySongSpotifyLink(
  orgId: string,
  songId: string,
  trackId: string | null,
  campaignStatus: string
): Promise<SpotifyLinkSave> {
  const saved = await saveSongSpotifyLink(orgId, songId, trackId);
  const open = (OPEN_CAMPAIGN_STATUSES as readonly string[]).includes(campaignStatus);
  if (saved === "changed" && trackId && open) {
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
