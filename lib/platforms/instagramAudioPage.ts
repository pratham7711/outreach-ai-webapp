/**
 * Reading an Instagram audio page's Open Graph block.
 *
 * Instagram publishes no audio API. There is no Graph edge for an audio
 * cluster, business_discovery returns media and never the sound behind it, and
 * `instagram_oembed` answers `(#10) … must be reviewed and approved` for this
 * app. What Instagram does publish is the ordinary Open Graph block on the
 * audio page itself, and that block carries the use count.
 *
 * It is served to a NON-BROWSER client. Measured 2026-09-17 against
 * instagram.com/reels/audio/2094289147512017/ — nine user-agents, one page:
 *
 *   no UA header          200  711411B  og:description present
 *   MadeBoringBot/1.0     200  711497B  og:description present
 *   curl/8.7.1            200  711566B  og:description present
 *   facebookexternalhit   200  711433B  og:description present
 *   Twitterbot / Slackbot 200  ~711.5KB og:description present
 *   Googlebot / bingbot   200  ~712.1KB og:description present
 *   Chrome 153 desktop    200  627369B  NO og tags — the client-rendered shell
 *
 * So the reader identifies itself honestly as our own bot and is served the
 * public metadata any link preview gets. It does not need to pretend to be a
 * named crawler — an anonymous request works identically — and it must not
 * claim to be a browser, which is the one thing that gets the empty shell.
 *
 * Three shapes come back, and telling them apart is the whole job here,
 * because two of them are 200s that look like success:
 *
 *   licensed music   og:title       "AURORA | Runaway on Instagram"
 *                    og:description "1M reels - Listen to AURORA on Instagram…"
 *
 *   original audio   og:title       "avawillyums | Original audio on Instagram"
 *                    og:description "Listen to avawillyums on Instagram and
 *                                    watch reels with original audio"
 *                    -- exists, but publishes NO count at all.
 *
 *   no such audio    og:title       "Audio on Instagram"
 *                    og:description "Discover the most recent and top videos…"
 *                    og:image       absent
 *                    -- and it answers 200, not 404.
 *
 * A fabricated id returned that last shape with a 200 and 710868 bytes, which
 * is why "we got a page" is not evidence the audio exists. Reporting it as zero
 * uses would put a real-looking zero on a tracker for something that was never
 * there.
 */

export type InstagramAudioReading = {
  /** Videos using this audio, as Instagram publishes it. */
  usesCount: number;
  /**
   * Whether that number is the one Instagram printed or the one it rounded to.
   *
   * Instagram abbreviates above some threshold — "1M reels" is the only
   * abbreviated form observed directly, on the AURORA page. A rounded level is
   * still worth recording; a DELTA between two rounded levels is not, because
   * the change from 999,999 to 1,000,000 and the change from 950,000 to
   * 1,000,000 print identically, and subtracting yesterday's rounded figure
   * from today's invents whichever gap the rounding happens to expose.
   */
  precision: "exact" | "rounded";
  title: string | null;
  artist: string | null;
  coverImageUrl: string | null;
};

export type InstagramAudioPageResult =
  | { kind: "reading"; reading: InstagramAudioReading }
  /** The audio page exists but publishes no count. Original audio does this. */
  | { kind: "no-count"; title: string | null; artist: string | null; coverImageUrl: string | null }
  /** The generic shell Instagram serves for an id that is not an audio page. */
  | { kind: "not-found" }
  /** HTML arrived, but with no Open Graph block at all — the browser shell, or
   *  a layout we have not seen. Distinct from not-found: the audio may well
   *  exist and this reader simply could not see it. */
  | { kind: "unreadable"; reason: "no-og-block" };

function meta(html: string, property: string): string | null {
  /* Attribute order is not guaranteed, so both orderings are matched rather
     than assuming Instagram keeps emitting property-then-content. */
  const forward = new RegExp(
    `<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']*)["']`,
    "i",
  );
  const reverse = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:${property}["']`,
    "i",
  );
  const m = html.match(forward) ?? html.match(reverse);
  return m ? decodeEntities(m[1]).trim() || null : null;
}

/** The handful of entities Instagram actually emits in these two tags. A full
 *  HTML entity table would be more code than the strings justify. */
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'");
}

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/**
 * "1M reels" -> 1000000 rounded · "9,482 reels" -> 9482 exact · "1 reel" -> 1.
 *
 * Returns null when the string does not open with a count, which is how
 * original audio is told from music: its description opens with "Listen to".
 *
 * Only the abbreviated form was observed live ("1M"), so the exact-number
 * branch is written to the shape Instagram uses elsewhere (comma grouping)
 * rather than to a measurement. It is the conservative direction: an unexpected
 * shape returns null and the caller reports no-count, instead of a number
 * parsed out of a string that meant something else.
 */
export function parseUsesCount(description: string): Pick<InstagramAudioReading, "usesCount" | "precision"> | null {
  const m = description.match(/^\s*([\d][\d.,]*)\s*([KMB])?\s+reels?\b/i);
  if (!m) return null;

  const [, digits, rawSuffix] = m;
  const suffix = rawSuffix?.toLowerCase();

  /* "1,234" is grouping; "1.5" before a suffix is a fraction. A bare number
     with a dot and no suffix is not a count Instagram writes, so it is refused
     rather than guessed at. */
  let value: number;
  if (suffix) {
    const n = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    value = n * SUFFIX[suffix];
  } else {
    if (digits.includes(".")) return null;
    const n = Number(digits.replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    value = n;
  }

  if (!Number.isFinite(value) || value < 0) return null;
  return { usesCount: Math.round(value), precision: suffix ? "rounded" : "exact" };
}

/**
 * "AURORA | Runaway on Instagram" -> { artist: "AURORA", title: "Runaway" }.
 *
 * The generic shell's title has no pipe ("Audio on Instagram"), which is the
 * cheapest reliable way to recognise it — both real shapes carry one.
 */
export function parseAudioTitle(ogTitle: string | null): { artist: string | null; title: string | null } | null {
  if (!ogTitle) return null;
  const bar = ogTitle.indexOf("|");
  if (bar === -1) return null;

  const artist = ogTitle.slice(0, bar).trim();
  const rest = ogTitle
    .slice(bar + 1)
    .replace(/\s+on\s+Instagram\s*$/i, "")
    .trim();
  return { artist: artist || null, title: rest || null };
}

export function parseInstagramAudioPage(html: string): InstagramAudioPageResult {
  const ogTitle = meta(html, "title");
  const ogDescription = meta(html, "description");

  if (!ogTitle && !ogDescription) return { kind: "unreadable", reason: "no-og-block" };

  const named = parseAudioTitle(ogTitle);
  if (!named) return { kind: "not-found" };

  const coverImageUrl = meta(html, "image");
  const count = ogDescription ? parseUsesCount(ogDescription) : null;

  if (!count) {
    return { kind: "no-count", title: named.title, artist: named.artist, coverImageUrl };
  }

  return {
    kind: "reading",
    reading: {
      usesCount: count.usesCount,
      precision: count.precision,
      title: named.title,
      artist: named.artist,
      coverImageUrl,
    },
  };
}

/** The audio page as Instagram serves it to a non-browser client. `hl=en` so
 *  the count string this parser reads is not localised out from under it. */
export function instagramAudioPageUrl(audioId: string): string {
  return `https://www.instagram.com/reels/audio/${encodeURIComponent(audioId)}/?hl=en`;
}
