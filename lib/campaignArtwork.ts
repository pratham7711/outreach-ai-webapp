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
 */
export type CampaignArtworkSource = {
  thumbnailUrl?: string | null;
  song?: {
    coverUrl?: string | null;
    sound?: { coverImageUrl?: string | null } | null;
  } | null;
};

/** What to include in a Prisma query for campaignArtwork() to have its inputs. */
export const CAMPAIGN_ARTWORK_INCLUDE = {
  select: {
    coverUrl: true,
    sound: { select: { coverImageUrl: true } },
  },
} as const;

export function campaignArtwork(campaign: CampaignArtworkSource): string | null {
  return (
    campaign.thumbnailUrl ??
    campaign.song?.sound?.coverImageUrl ??
    campaign.song?.coverUrl ??
    null
  );
}
