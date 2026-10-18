/**
 * Post media: where the picture comes from, and how to play the post.
 *
 * Both halves used to live inside the post-detail page, so every other surface
 * that showed a post -- the posts list, the campaign page, the dashboard --
 * rendered initials and a text link instead. Shared here so a post looks the
 * same wherever it appears.
 */

/**
 * Thumbnails and profile pictures imported from CreatorCore are Bubble CDN
 * paths stored protocol-relative ("//host/path"). A browser resolves those
 * against the page, which works, but `new URL()` throws on them and any code
 * that inspects the host silently treats them as broken. Normalising once here
 * means callers never have to think about it.
 */
export function mediaUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("http://")) return `https://${s.slice("http://".length)}`;
  return s;
}

/** A YouTube video's eleven-character id, from the stored id when it has that shape, else from the URL. */
export function youtubeVideoId(platformPostId: string | null | undefined, postUrl: string | null | undefined): string | null {
  const id = platformPostId?.trim();
  if (id && /^[\w-]{11}$/.test(id)) return id;
  return (postUrl ?? "").match(/(?:youtu\.be\/|[?&]v=|\/shorts\/|\/live\/|\/embed\/)([\w-]{11})/)?.[1] ?? null;
}

/**
 * A post's picture: the stored thumbnail, or for a YouTube post with none, the
 * one YouTube serves for every video at a fixed address. The Data API writes
 * null without a key or past its quota, which left YouTube cards blank although
 * the picture was always there to be had.
 */
export function postThumbnailUrl(post: {
  platform: string;
  platformPostId?: string | null;
  postUrl?: string | null;
  thumbnailUrl?: string | null;
}): string | null {
  if (post.thumbnailUrl) return post.thumbnailUrl;
  if (post.platform !== "YOUTUBE") return null;
  const vid = youtubeVideoId(post.platformPostId, post.postUrl);
  return vid ? `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` : null;
}

/**
 * Each platform publishes its own embed player, so a post can be watched in
 * place rather than in a new tab. Anything we cannot build a player URL for
 * keeps the still thumbnail and the outbound link.
 */
export function embedSrcFor(
  platform: string,
  platformPostId: string | null | undefined,
  postUrl: string | null | undefined
): string | null {
  const id = platformPostId?.trim();
  const url = postUrl ?? "";
  switch (platform) {
    case "TIKTOK": {
      // A TikTok id is numeric; anything else came from a handle-style URL.
      const numeric = id && /^\d+$/.test(id) ? id : url.match(/\/video\/(\d+)/)?.[1];
      return numeric ? `https://www.tiktok.com/embed/v2/${numeric}` : null;
    }
    case "YOUTUBE": {
      /* A YouTube video id is exactly eleven characters. CreatorCore's import
         stored its own 32-character record id in platformPostId on 838 posts,
         and handing that to the player drew "Video unavailable" for every one
         of them, so the stored id is only trusted when it has the right shape. */
      const vid = youtubeVideoId(id, url);
      return vid ? `https://www.youtube.com/embed/${vid}` : null;
    }
    case "INSTAGRAM": {
      // The URL names the post; a stored id can be an importer's record id.
      const shortcode = url.match(/\/(?:p|reel|reels|tv)\/([^/?#]+)/)?.[1] ?? id;
      return shortcode ? `https://www.instagram.com/p/${shortcode}/embed` : null;
    }
    default:
      return null;
  }
}

/** Aspect ratio the platform's own player uses, so the frame does not letterbox. */
export function embedAspect(platform: string): { width: number; height: number } {
  switch (platform) {
    case "YOUTUBE":
      return { width: 720, height: 405 };
    case "INSTAGRAM":
      return { width: 400, height: 600 };
    default:
      // TikTok's iframe player needs headroom for its own chrome.
      return { width: 340, height: 740 };
  }
}

/**
 * The hosts /api/img is willing to fetch. The proxy enforces this itself -- it
 * is an SSRF boundary and cannot be talked out of it from the client -- but the
 * list lives here so imgSrc can tell, before rendering, whether a given URL
 * would come back as a 403.
 */
export const PROXYABLE_HOSTS: RegExp[] = [
  /\.cdn\.bubble\.io$/,
  // TikTok serves media from several regional CDN families, and which one a
  // given post lands on is not ours to choose: covers came back on
  // p77-sg.tiktokcdn.com while only the -us family was listed, so those images
  // skipped the proxy, went straight to the browser, and rendered as empty
  // boxes on any network that filters TikTok -- which includes every Indian ISP.
  /\.tiktokcdn\.com$/,
  /\.tiktokcdn-us\.com$/,
  /\.tiktokcdn-eu\.com$/,
  /\.cdninstagram\.com$/,
  // Meta serves the same images from two families and picks between them per
  // request: the profile pictures arrive on scontent-*.cdninstagram.com, while
  // post covers come back on instagram.<edge>.fna.fbcdn.net. Only the first was
  // listed, so a cover skipped the proxy, went straight to the browser and
  // answered 403 -- MEASURED 2026-09-15 on the PARA PARA posts tab, one direct
  // request to instagram.fdel11-3.fna.fbcdn.net. Same shape as the tiktokcdn
  // note above, same consequence on any network that filters Meta.
  /\.fbcdn\.net$/,
  /^i\.ytimg\.com$/,
  // YouTube channel pictures, which the avatar store downloads.
  /^yt3\.ggpht\.com$/,
  /^yt3\.googleusercontent\.com$/,
];

export function isProxyableHost(host: string): boolean {
  return PROXYABLE_HOSTS.some((re) => re.test(host));
}

/**
 * Every CDN image goes through /api/img, which normalises it to the size the
 * page actually paints and re-encodes to WebP.
 *
 * Two reasons, not one. Avatars are HEIC, which no browser decodes at all. And
 * the CDN stores everything at capture size, so a 56px thumbnail was pulling a
 * half-megabyte PNG -- a creator page cost 4.5 MB of images to draw 13 circles.
 *
 * Pass the pixel box you are rendering into, doubled for retina. Ask for
 * exactly what you paint: the response is cached per (url, w, h), so a page
 * inventing its own widths just multiplies transcodes.
 */
/**
 * The widths the proxy is actually asked for.
 *
 * The URL is the cache key, both in the browser and at the edge, so one avatar
 * requested at 64 by a post card, 112 by the creators table and 128 by a detail
 * header is three separate entries and -- more to the point -- three separate
 * fetches from the upstream CDN. Measured, that fetch is 376ms and the transcode
 * we do afterwards is 4ms: the round trip is the entire cost, so the win is in
 * not making it three times.
 *
 * Snapping up, never down, so nothing is ever painted from fewer pixels than it
 * asked for. The extra bytes are negligible at these sizes -- a 96px avatar
 * lands at about 2KB of WebP.
 */
const PROXY_WIDTHS = [64, 96, 128, 192, 256, 384, 512, 768, 1024] as const;

function snapWidth(width: number): number {
  return PROXY_WIDTHS.find((w) => w >= width) ?? PROXY_WIDTHS[PROXY_WIDTHS.length - 1];
}

/**
 * Only square requests are snapped. A thumbnail asked for as 240x160 has a
 * deliberate aspect ratio and the proxy crops to `cover`, so rounding its width
 * up on its own would quietly re-crop the picture.
 */
function proxyBox(width: number, height?: number): { w: number; h?: number } {
  if (height !== undefined && height !== width) return { w: width, h: height };
  return { w: snapWidth(width) };
}

export function imgSrc(
  raw: string | null | undefined,
  width = 96,
  height?: number
): string | null {
  if (raw && (OWN_POST_THUMBNAIL.test(raw) || OWN_SOUND_COVER.test(raw))) return withBox(raw, width, height);
  const url = mediaUrl(raw);
  if (!url) return null;

  // Only the CDNs we import from can go through the proxy. Anything else -- a
  // logo or thumbnail somebody pasted into a form, pointing at their own site --
  // used to be sent there anyway and came back 403, so a perfectly good image
  // rendered as an empty box. Those go straight to the browser instead: it
  // needs no transcode (nobody else serves us HEIC) and a client-side fetch of
  // a third-party URL is not something the proxy protects us from anyway.
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  if (!isProxyableHost(host)) return url;

  const box = proxyBox(width, height);
  const h = box.h ? `&h=${box.h}` : "";
  return `/api/img?u=${encodeURIComponent(url)}&w=${box.w}${h}`;
}

/**
 * The same thing for a public share link, which has no session and so cannot use
 * /api/img at all. Reaching for imgSrc there produced a 401 and a broken box on
 * the one page a brand actually sees; going direct to the CDN produced a broken
 * box too, because the avatars are image/heic.
 *
 * Takes the token rather than reading it from context so it stays a pure
 * function, callable from a server component and a client one alike.
 */
export function shareImgSrc(
  token: string,
  raw: string | null | undefined,
  width = 96,
  height?: number
): string | null {
  if (raw && (SHARE_POST_THUMBNAIL.test(raw) || SHARE_SOUND_COVER.test(raw))) return withBox(raw, width, height);
  const url = mediaUrl(raw);
  if (!url) return null;

  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return null;
  }
  // Same reasoning as imgSrc: a URL the proxy would refuse goes straight to the
  // browser rather than being sent there to come back 403.
  if (!isProxyableHost(host)) return url;

  const box = proxyBox(width, height);
  const h = box.h ? `&h=${box.h}` : "";
  return `/api/share/${encodeURIComponent(token)}/img?u=${encodeURIComponent(url)}&w=${box.w}${h}`;
}

/**
 * Our own copy of a post's picture (lib/posts/thumbnailStore), as the path a
 * screen paints.
 *
 * The server puts this path where the picture's URL goes -- PostDto's
 * thumbnailUrl, the share report's row -- whenever a copy exists, so the
 * components that draw a post (PostCover, PostMedia, the share card) take it
 * exactly as they take a CDN link: through imgSrc or shareImgSrc, which add
 * the box they are painting. The version is the copy's fetchedAt, so a newer
 * copy is a new URL rather than a day-old cache hit.
 *
 * Each helper recognises only its own family. A signed-in path on the public
 * report would be a 401, and a share path on the dashboard would answer for
 * one campaign only, so neither is let through the other's door.
 */
const OWN_POST_THUMBNAIL = /^\/api\/posts\/[^/?#]+\/thumbnail(\?|$)/;
const SHARE_POST_THUMBNAIL = /^\/api\/share\/[^/?#]+\/thumbnail\/[^/?#]+(\?|$)/;

export function postThumbnailPath(postId: string, version: number): string {
  return `/api/posts/${encodeURIComponent(postId)}/thumbnail?v=${version}`;
}

export function sharePostThumbnailPath(token: string, postId: string, version: number): string {
  return `/api/share/${encodeURIComponent(token)}/thumbnail/${encodeURIComponent(postId)}?v=${version}`;
}

/**
 * Our own copy of a sound's cover (lib/sounds/coverStore), on the same terms
 * as a post's: the server puts it where the cover's URL goes whenever a copy
 * exists, and the version is the copy's fetchedAt. The share path names no
 * sound -- the link's own campaign decides which one it serves.
 */
const OWN_SOUND_COVER = /^\/api\/sounds\/[^/?#]+\/cover(\?|$)/;
const SHARE_SOUND_COVER = /^\/api\/share\/[^/?#]+\/sound-cover(\?|$)/;

export function soundCoverPath(soundId: string, version: number): string {
  return `/api/sounds/${encodeURIComponent(soundId)}/cover?v=${version}`;
}

export function shareSoundCoverPath(token: string, version: number): string {
  return `/api/share/${encodeURIComponent(token)}/sound-cover?v=${version}`;
}

/** The box, in the proxy's own snapped widths, appended to one of our paths. */
function withBox(path: string, width: number, height?: number): string {
  const box = proxyBox(width, height);
  const h = box.h ? `&h=${box.h}` : "";
  return `${path}${path.includes("?") ? "&" : "?"}w=${box.w}${h}`;
}
