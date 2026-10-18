import { mediaUrl, youtubeVideoId } from "@/lib/postMedia";

/*
 * Which picture a campaign's stored thumbnail value names, and when two links
 * name the same picture (used by the sound cover store too). Kept apart from
 * lib/campaigns/thumbnailCopy, which talks to the database, so the artwork
 * resolver (lib/campaignArtwork) can use it anywhere.
 */

/* Pages, not pictures. A campaign's thumbnail was once a free-text field, and
   the audio's own link -- a TikTok music page, a YouTube video -- was pasted
   into it often enough to be a pattern (9 of 545 campaigns, 2026-10-18). */
const PAGE_HOSTS = /(^|\.)(tiktok\.com|instagram\.com|youtube\.com|youtu\.be|spotify\.com|facebook\.com|twitter\.com|x\.com)$/i;

/**
 * The picture a stored thumbnail value names, as a fetchable link: protocol
 * normalised the way the screens normalise it, a YouTube video turned into the
 * thumbnail YouTube serves at a fixed address, and any other page link
 * dropped. Null when the value names no picture.
 */
export function pictureLink(raw: string | null | undefined): string | null {
  const url = mediaUrl(raw);
  if (!url) return null;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(hostname)) {
    const id = youtubeVideoId(null, url);
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : null;
  }
  if (PAGE_HOSTS.test(hostname)) return null;
  return url;
}

/**
 * What names one picture across links to it. TikTok re-signs and re-hosts the
 * same object on every read, so there it is the object key; Instagram serves
 * one file name from many regional hosts, so there it is the file name;
 * elsewhere the whole path, since a last segment alone is not unique -- every
 * CreatorCore upload is "image.png" and every YouTube picture "hqdefault.jpg".
 */
export function pictureKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { hostname, pathname } = new URL(url);
    const last = pathname.split("/").pop() ?? "";
    // "<key>~tplv-….jpeg" on one host, "<key>.jpeg" under /aweme/ on another.
    if (/tiktokcdn/.test(hostname)) return last.split("~")[0].replace(/\.(jpe?g|png|webp|heic|image)$/i, "") || null;
    if (/(^|\.)(cdninstagram\.com|fbcdn\.net)$/.test(hostname)) return last || null;
    return `${hostname}${pathname}`;
  } catch {
    return null;
  }
}

/**
 * One address, whatever its signature. What a failed download is remembered
 * by: the same picture can be gone from one host and served by another
 * (2026-10-19, a sound's cover answered 404 on TikTok's Singapore host and 200
 * on its US one), so a failure says nothing about the picture's other links.
 */
export function linkKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { hostname, pathname } = new URL(url);
    return `${hostname}${pathname}`;
  } catch {
    return null;
  }
}
