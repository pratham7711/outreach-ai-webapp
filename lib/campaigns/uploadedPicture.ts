/*
 * The thumbnail value a picture uploaded for a campaign is stored under. Kept
 * apart from lib/campaigns/thumbnailCopy, which talks to the database, so the
 * Edit tab can tell an upload from a sound's cover too.
 */

/**
 * The thumbnail value an uploaded picture is filed under: this app's own
 * address for the campaign's picture. The copy and the campaign then name the
 * same picture (pictureKey reads host and path), so every screen that already
 * prefers our copy -- the campaigns list, the client report -- shows the
 * upload with no change of its own. The query only tells uploads apart.
 */
export function uploadedThumbnailUrl(origin: string, campaignId: string, digest: string): string {
  return `${origin}/api/campaigns/${encodeURIComponent(campaignId)}/thumbnail?upload=${digest}`;
}

/** Whether a campaign's thumbnail value is a picture somebody uploaded for it. */
export function isUploadedThumbnailUrl(url: string | null | undefined, campaignId: string): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.pathname === `/api/campaigns/${encodeURIComponent(campaignId)}/thumbnail` && u.searchParams.has("upload");
  } catch {
    return false;
  }
}
