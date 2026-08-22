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
      const vid = id || url.match(/(?:youtu\.be\/|[?&]v=|\/shorts\/)([\w-]{6,})/)?.[1];
      return vid ? `https://www.youtube.com/embed/${vid}` : null;
    }
    case "INSTAGRAM": {
      const shortcode = id || url.match(/\/(?:p|reel|reels)\/([^/?#]+)/)?.[1];
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
  /^i\.ytimg\.com$/,
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
export function imgSrc(
  raw: string | null | undefined,
  width = 96,
  height?: number
): string | null {
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

  const h = height && height !== width ? `&h=${height}` : "";
  return `/api/img?u=${encodeURIComponent(url)}&w=${width}${h}`;
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

  const h = height && height !== width ? `&h=${height}` : "";
  return `/api/share/${encodeURIComponent(token)}/img?u=${encodeURIComponent(url)}&w=${width}${h}`;
}
