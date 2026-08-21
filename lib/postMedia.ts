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
