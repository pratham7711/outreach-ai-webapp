import { shortcodeFromUrl } from "@/lib/platforms/instagram";

/**
 * Whose post it is, read off the post's own public page.
 *
 * The embed is the first place this app asks, and it names the owner -- when
 * it shows the post at all. An owner can switch embedding off, and then the
 * embed serves the same "may have been removed" page a deleted post gets, so a
 * live reel looked deleted and stayed unattributed. MEASURED 2026-10-10 on the
 * six live LKM posts stuck under the holding row: the embed refused five, and
 * the post page, fetched by a non-browser client, named the owner in og:url for
 * four of them -- three of the five the embed called removed, plus the one it
 * did show, where both agreed.
 *
 * Same rules as the audio page reader (lib/platforms/instagramAudioPage): an
 * honest bot user-agent gets the server-rendered Open Graph block, a browser
 * user-agent gets the empty shell. The remaining two posts, and a fabricated
 * shortcode, all came back as that identical ~631KB shell with no og:url --
 * a deleted post and a private account's post look the same logged out, and
 * this reader says nothing about either.
 *
 * Only og:url is trusted, and only when it names this post's shortcode: it is
 * `https://www.instagram.com/<owner>/reel/<shortcode>/`, the one field on the
 * page that is structured rather than prose.
 */

const USER_AGENT = "MadeBoringBot/1.0 (+https://campaign.madeboring.com)";
const TIMEOUT_MS = 6000;

/* Instagram's own rule: letters, digits, dot, underscore, at most 30. */
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;

function ogUrl(html: string): string | null {
  const m =
    html.match(/<meta[^>]*property=["']og:url["'][^>]*content=["']([^"']*)["']/i) ??
    html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:url["']/i);
  return m ? m[1].trim() || null : null;
}

/** The owner the page names for this shortcode, or null when it names nobody. */
export function parseInstagramPostPageOwner(html: string, shortcode: string): string | null {
  const url = ogUrl(html);
  if (!url) return null;
  let path: string[];
  try {
    const u = new URL(url);
    if (!/(^|\.)instagram\.com$/.test(u.hostname)) return null;
    path = u.pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
  /* Exactly owner / kind / shortcode. A page that drops the owner
     (/reel/<code>/) would otherwise hand back "reel" as a handle. */
  if (path.length !== 3) return null;
  const [owner, kind, code] = path;
  if (!["p", "reel", "reels", "tv"].includes(kind) || code !== shortcode) return null;
  return HANDLE.test(owner) ? owner : null;
}

/**
 * Fetches the post's public page and returns its owner's handle, without the
 * "@". Never throws: a page that will not load, or names nobody, is null.
 */
export async function readInstagramPostPageOwner(postUrl: string, timeoutMs = TIMEOUT_MS): Promise<string | null> {
  const shortcode = shortcodeFromUrl(postUrl);
  if (!shortcode) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`https://www.instagram.com/p/${shortcode}/`, {
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) return null;
    return parseInstagramPostPageOwner(await res.text(), shortcode);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
