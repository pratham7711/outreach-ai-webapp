import { signedUrlExpiry } from "@/lib/sounds/coverUrl";

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
 * A signed CDN link is a picture with a shelf life. The audio setup copied the
 * sound's signed cover into thumbnailUrl, where nothing ever renews it, so our
 * own copy of the sound's cover (`storedCover`, lib/sounds/coverStore) beats
 * any signed link, and a link past its signature is skipped rather than
 * painted as a broken box. A thumbnail with no signature is somebody's own
 * choice and still comes first.
 */
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
  storedCover: string | null = null,
  now: number = Date.now()
): string | null {
  const thumbnail = campaign.thumbnailUrl;
  if (thumbnail && signedUrlExpiry(thumbnail) === null) return thumbnail;
  if (storedCover) return storedCover;
  return [thumbnail, campaign.song?.sound?.coverImageUrl, campaign.song?.coverUrl].find((u) => isLive(u, now)) ?? null;
}
