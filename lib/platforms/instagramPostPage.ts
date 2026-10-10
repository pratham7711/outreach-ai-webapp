import { shortcodeFromUrl } from "@/lib/platforms/instagram";
import { readInstagramPostPageElsewhere } from "@/lib/platforms/instagramPostPageElsewhere";

/**
 * A post's own public page, read the way a link preview reads it.
 *
 * Instagram's official reader (Business Discovery) answers only while Meta's
 * hourly allowance lasts and only for professional accounts, and the embed
 * shows nothing for a post whose owner switched embedding off -- it serves the
 * same "may have been removed" page a deleted post gets. Both failed at once on
 * 2026-10-10 for the six LKM posts stuck under the holding row: Meta's app usage
 * stood at 112% and the embed refused five of the six.
 *
 * The page itself, fetched by a non-browser client, still carries an Open Graph
 * block. MEASURED that day on those six posts from a residential address:
 *
 *   og:url          https://www.instagram.com/<owner>/reel/<shortcode>/ -- the
 *                   owner, on four of six (and the one the embed did name
 *                   agreed with it)
 *   og:image        the cover with a play button drawn on it, 360x640
 *   og:description  "116 likes, 0 comments - <owner> on <date>: …" when the
 *                   counts are public; "<owner> on <date>: …" when they are not
 *
 * Same rules as the audio page reader (lib/platforms/instagramAudioPage): an
 * honest bot user-agent gets the server-rendered block, a browser user-agent
 * gets the empty shell. No cookie, no login, nothing but the public page.
 *
 * The other two posts got the ~631KB shell a made-up shortcode also gets, and
 * Instagram's public thumbnail address (/p/<code>/media/) answered 404 for both
 * while it redirected to an image for the four live ones. Two routes agreeing
 * that the public cannot see a post is the "not-public" verdict below; either
 * alone is not, since a page can come back short for reasons of our own.
 *
 * The public thumbnail address answers a public post with a redirect to the
 * clean cover (720x1280 and up on the same four), so that is the cover kept;
 * og:image is the fallback when it does not.
 *
 * "Not public" is per country, and this server sits in one. Before that
 * verdict stands it is asked again from other regions
 * (lib/platforms/instagramPostPageElsewhere); one of the six LKM posts was
 * hidden from Singapore only.
 *
 * Views are on none of this. They stay with the official readers.
 */

const USER_AGENT = "MadeBoringBot/1.0 (+https://campaign.madeboring.com)";
const TIMEOUT_MS = 6000;

/* Instagram's own rule: letters, digits, dot, underscore, at most 30. */
const HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const POST_KINDS = new Set(["p", "reel", "reels", "tv"]);
const CDN_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net)$/;

export type InstagramPostPageReading = {
  owner: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  /** Present only when the page printed an exact count. */
  likesCount?: number;
  commentsCount?: number;
};

export type InstagramPostPage =
  | ({ kind: "public" } & InstagramPostPageReading)
  /** The page shows no post and the public thumbnail address says 404:
   *  deleted, or on a private account. Instagram does not say which. */
  | { kind: "not-public" }
  /** We could not tell -- a failed request, or a page that named nothing while
   *  the thumbnail address still answered. Says nothing about the post. */
  | { kind: "unreadable"; thumbnailUrl: string | null };

function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function og(html: string, property: string): string | null {
  const m =
    html.match(new RegExp(`<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']*)["']`, "i")) ??
    html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:${property}["']`, "i"));
  return m ? decodeEntities(m[1]).trim() || null : null;
}

function cdnUrl(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && CDN_HOST.test(u.hostname) ? u.toString() : null;
  } catch {
    return null;
  }
}

/* "1,234" only. An abbreviated "12K" is a rounded figure, and storing it would
   put a made-up exact number on a post. */
function exactCount(raw: string): number | undefined {
  if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(raw)) return undefined;
  return Number(raw.replace(/,/g, ""));
}

/**
 * What the page says about this shortcode, or null when it does not name this
 * post at all -- the shell, or a page about something else.
 */
export function parseInstagramPostPage(html: string, shortcode: string): InstagramPostPageReading | null {
  const url = og(html, "url");
  if (!url) return null;
  let path: string[];
  try {
    const u = new URL(url);
    if (!/(^|\.)instagram\.com$/.test(u.hostname)) return null;
    path = u.pathname.split("/").filter(Boolean);
  } catch {
    return null;
  }
  /* owner/kind/shortcode, or kind/shortcode when the page leaves the owner
     out. Anything else is not a post page, and a page that drops the owner
     must not hand back "reel" as a handle. */
  let owner: string | null = null;
  if (path.length === 3 && POST_KINDS.has(path[1]) && path[2] === shortcode) {
    owner = HANDLE.test(path[0]) ? path[0] : null;
  } else if (!(path.length === 2 && POST_KINDS.has(path[0]) && path[1] === shortcode)) {
    return null;
  }

  const description = og(html, "description") ?? "";
  const counts = description.match(/^([\d,.]+[KkMm]?) likes?, ([\d,.]+[KkMm]?) comments? - /);
  const likes = counts ? exactCount(counts[1]) : undefined;
  const comments = counts ? exactCount(counts[2]) : undefined;
  const caption = description.match(/ on [A-Z][a-z]+ \d{1,2}, \d{4}: ([\s\S]*)$/)?.[1]?.replace(/^"|"$/g, "").trim() || null;

  return {
    owner,
    thumbnailUrl: cdnUrl(og(html, "image")),
    caption,
    /* A zero like count is how a creator who hid their likes reads, so only a
       positive one is a measurement -- the embed's rule (instagramEmbed.ts). */
    ...(typeof likes === "number" && likes > 0 ? { likesCount: likes } : {}),
    ...(typeof likes === "number" && likes > 0 && typeof comments === "number" ? { commentsCount: comments } : {}),
  };
}

async function get(url: string, timeoutMs: number, redirect: RequestRedirect): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        /* English, so the counts in og:description parse. */
        "accept-language": "en-US,en;q=0.9",
        accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
      redirect,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPage(shortcode: string, timeoutMs: number): Promise<string | null> {
  const res = await get(`https://www.instagram.com/p/${shortcode}/`, timeoutMs, "follow");
  if (!res?.ok) return null;
  try {
    return await res.text();
  } catch {
    return null;
  }
}

function mediaCover(status: number | null, location: string | null): string | null {
  if (status === null || status < 300 || status >= 400) return null;
  return cdnUrl(location);
}

/* What one place was shown -- the page and the thumbnail address's answer --
   as a verdict. A 404 alone is not enough: the page must be empty too. */
function verdict(html: string, shortcode: string, mediaStatus: number | null, mediaLocation: string | null): InstagramPostPage {
  const reading = parseInstagramPostPage(html, shortcode);
  const cover = mediaCover(mediaStatus, mediaLocation);
  if (reading) return { kind: "public", ...reading, thumbnailUrl: cover ?? reading.thumbnailUrl };
  if (mediaStatus === 404) return { kind: "not-public" };
  return { kind: "unreadable", thumbnailUrl: cover };
}

/**
 * Reads the post's public page and its public thumbnail address; never
 * throws. The address gives the clean cover for a public post, and tells "not
 * public" apart from a page that simply came back short. A post not public
 * from here is asked about from other regions, and the first that sees it
 * wins; not public is the answer only when none does.
 */
export async function readInstagramPostPage(postUrl: string, timeoutMs = TIMEOUT_MS): Promise<InstagramPostPage> {
  const shortcode = shortcodeFromUrl(postUrl);
  if (!shortcode) return { kind: "unreadable", thumbnailUrl: null };

  const html = await fetchPage(shortcode, timeoutMs);
  if (html === null) return { kind: "unreadable", thumbnailUrl: null };
  const media = await get(`https://www.instagram.com/p/${shortcode}/media/?size=l`, timeoutMs, "manual");
  const here = verdict(html, shortcode, media?.status ?? null, media?.headers.get("location") ?? null);
  if (here.kind !== "not-public") return here;

  /* Regions that could not answer are left out, so a sandbox that will not
     boot keeps the verdict made here rather than inventing a doubt. */
  for (const there of await readInstagramPostPageElsewhere(shortcode)) {
    const seen = verdict(there.html, shortcode, there.mediaStatus, there.mediaLocation);
    if (seen.kind === "public") return seen;
  }
  return here;
}

/** The owner's handle, without the "@", or null when the page names nobody. */
export async function readInstagramPostPageOwner(postUrl: string, timeoutMs = TIMEOUT_MS): Promise<string | null> {
  const shortcode = shortcodeFromUrl(postUrl);
  if (!shortcode) return null;
  const html = await fetchPage(shortcode, timeoutMs);
  return html === null ? null : (parseInstagramPostPage(html, shortcode)?.owner ?? null);
}
