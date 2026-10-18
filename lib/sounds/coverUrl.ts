/* TikTok serves cover art from its signed CDN: every URL carries an x-expires
   timestamp and an x-signature over it, and once that timestamp passes the CDN
   answers an error rather than the image. A stored cover therefore rots on a
   timer while the row holding it still looks perfectly healthy -- nothing goes
   red, the sound keeps taking readings, and the only symptom is a campaign
   report that quietly loses its artwork.

   Measured on this database's post thumbnails, which come from the same
   p16-sign-*.tiktokcdn.com hosts: of 18,676 posts, 288 thumbnail URLs carry an
   x-expires, 92 of those are parseable, and all 92 had already passed it. None
   were live. */

/* Some stored URLs are not TikTok's directly but a Bubble CDN wrapper with the
   TikTok URL percent-encoded inside the query string, so the separator arrives
   as either "=" or "%3D". */
const EXPIRES_RE = /x-expires(?:=|%3D)(\d{9,12})/i;
/* Instagram's audio covers come off Meta's CDN, which signs the same way with
   a hex `oe=` (lib/creators/avatarStore reads it for profile pictures). */
const META_EXPIRES_RE = /[?&](?:amp;)?oe(?:=|%3D)([0-9A-Fa-f]{6,})/;

/* One cadence of slack. The hourly sweep gets many chances to renew a cover
   before it dies, and a reader that only runs nightly still gets one. */
const REFRESH_MARGIN_MS = 12 * 60 * 60 * 1000;

/** The moment a signed URL stops working, or null if it is not signed. */
export function signedUrlExpiry(url: string): number | null {
  const match = EXPIRES_RE.exec(url);
  const meta = match ? null : META_EXPIRES_RE.exec(url);
  if (!match && !meta) return null;
  const seconds = match ? Number(match[1]) : parseInt(meta![1], 16);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

/**
 * Should this stored cover be replaced with the one the reading just returned?
 *
 * Absent, yes -- that is the plain backfill. Signed and near its expiry, yes:
 * the reading handed us a freshly signed URL for nothing. Unsigned, no: it is
 * somebody's own upload or a permanent link, and rewriting it every hour would
 * be churn for its own sake.
 */
export function isCoverUrlStale(url: string | null | undefined, now: number = Date.now()): boolean {
  if (!url) return true;
  const expiresAt = signedUrlExpiry(url);
  if (expiresAt === null) return false;
  return expiresAt - now <= REFRESH_MARGIN_MS;
}

/**
 * The link, or null once it is past its signature. An expired link can only
 * draw a broken box, and null is what lets a screen show its placeholder.
 * Instagram audio readings return no cover at all, so an Instagram sound's link
 * is never renewed and expires a few days after the sound is added.
 */
export function unexpiredCoverUrl(url: string | null | undefined, now: number = Date.now()): string | null {
  if (!url) return null;
  const expiresAt = signedUrlExpiry(url);
  return expiresAt === null || expiresAt > now ? url : null;
}
