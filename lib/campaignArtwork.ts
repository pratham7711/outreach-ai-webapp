import { signedUrlExpiry } from "@/lib/sounds/coverUrl";
import { pictureLink } from "@/lib/campaigns/pictureLink";

/**
 * The picture a campaign shows.
 *
 * The new-campaign form no longer asks for a thumbnail URL. A campaign that
 * promotes a sound already has artwork -- the sound's cover -- and typing a
 * second URL by hand produced either nothing or a link that rots. So the
 * stored thumbnail is honoured where one exists (older campaigns, and the edit
 * screen still sets it) and the sound's cover stands in everywhere else.
 *
 * Sound before song, matching lib/reports/campaignPerformance.ts: the
 * TikTokSound's cover is fetched from the live sound page, while Song.coverUrl
 * is whatever was entered when the release was catalogued.
 *
 * A link is a picture only for as long as the server behind it keeps it. The
 * audio setup copied the sound's signed cover into thumbnailUrl, where nothing
 * renews it; CreatorCore uploads disappear; and a TikTok music page or YouTube
 * video pasted into the thumbnail was never a picture at all. So, in order:
 *
 *   1. our copy of the campaign's own picture (lib/campaigns/thumbnailCopy);
 *   2. its link, when unsigned and not already known not to draw -- somebody's
 *      own choice, kept ahead of the sound's cover;
 *   3. our copy of the sound's cover (lib/sounds/coverStore);
 *   4. whichever link is still inside its signature.
 *
 * Every link goes through pictureLink: a YouTube video becomes the picture
 * YouTube serves for it, and any other page link is dropped.
 */
export type StoredArtwork = {
  /** Path to our copy of the campaign's picture, when one is held. */
  thumbnail?: string | null;
  /** The campaign's picture failed to download and nothing is held. */
  thumbnailDead?: boolean;
  /** Path to our copy of the sound's cover, when one is held. */
  soundCover?: string | null;
};

export type CampaignArtworkSource = {
  thumbnailUrl?: string | null;
  song?: {
    coverUrl?: string | null;
    sound?: { id?: string; coverImageUrl?: string | null } | null;
  } | null;
};

/** What to include in a Prisma query for campaignArtwork() to have its inputs. */
export const CAMPAIGN_ARTWORK_INCLUDE = {
  select: {
    coverUrl: true,
    sound: { select: { id: true, coverImageUrl: true } },
  },
} as const;

function isLive(url: string | null | undefined, now: number): url is string {
  if (!url) return false;
  const expiresAt = signedUrlExpiry(url);
  return expiresAt === null || expiresAt > now;
}

export function campaignArtwork(
  campaign: CampaignArtworkSource,
  stored: StoredArtwork = {},
  now: number = Date.now()
): string | null {
  if (stored.thumbnail) return stored.thumbnail;
  const link = stored.thumbnailDead ? null : pictureLink(campaign.thumbnailUrl);
  if (link && signedUrlExpiry(link) === null) return link;
  if (stored.soundCover) return stored.soundCover;
  return (
    [link, pictureLink(campaign.song?.sound?.coverImageUrl), pictureLink(campaign.song?.coverUrl)].find((u) =>
      isLive(u, now)
    ) ?? null
  );
}
