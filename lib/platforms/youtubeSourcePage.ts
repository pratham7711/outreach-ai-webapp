/**
 * Reading a YouTube Shorts audio page: youtube.com/source/<videoId>/shorts.
 *
 * Every Short that uses a video's audio links back to this page, and it is a
 * public page that answers a plain GET with its data server-rendered in
 * `ytInitialData` (measured 2026-11-17). Three shapes were seen:
 *
 *   - A popular source: the header's second metadata row reads "137K Shorts"
 *     (dQw4w9WgXcQ), "2.9M Shorts" (kJQP7kiw5Fk), and the grid ends in a
 *     continuation. The header figure is the count.
 *   - A small source: the header has no count row, and the grid lists every
 *     Short with no continuation -- efCmfyPaK5U lists 6. The list IS the count,
 *     exactly.
 *   - No such source (AAAAAAAAAAA): ytInitialData carries no header at all.
 *
 * The one shape refused is a header without a count over a grid that
 * continues: the first page of Shorts is a floor, not a count, and recording it
 * would put a made-up flat line on a tracker.
 *
 * A browser user agent is the wrong thing to send: given Chrome's UA,
 * kJQP7kiw5Fk came back without its ytInitialData while the bot UA was served
 * the full page (measured the same day), so the reader identifies itself.
 */

export type YouTubeSourceReading = {
  /** Shorts using this audio, as YouTube publishes it or as the page lists them. */
  usesCount: number;
  /** "137K Shorts" is rounded; "1,204 Shorts" and a fully listed grid are exact. */
  precision: "exact" | "rounded";
  title: string | null;
  artist: string | null;
  coverImageUrl: string | null;
};

export type YouTubeSourcePageResult =
  | { kind: "reading"; reading: YouTubeSourceReading }
  /** The source exists, but the page neither prints a count nor lists every Short. */
  | { kind: "no-count"; title: string | null; artist: string | null; coverImageUrl: string | null }
  /** ytInitialData without a header: YouTube has no such source. */
  | { kind: "not-found" }
  /** No ytInitialData at all -- a consent wall, a redirect, or a layout we have not seen. */
  | { kind: "unreadable" };

/** YouTube video ids are eleven characters of base64url. */
export const YOUTUBE_VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;

export function youtubeSourcePageUrl(videoId: string): string {
  return `https://www.youtube.com/source/${encodeURIComponent(videoId)}/shorts`;
}

/** The page people open, for links in the app. Same as the read URL. */
export function youtubeSoundPageUrl(videoId: string): string {
  return youtubeSourcePageUrl(videoId);
}

/**
 * The JSON object that starts at the first "{" after `marker`, read by bracket
 * depth with strings skipped. A regex over `;</script>` breaks on pages whose
 * data contains that sequence inside a string, which some do.
 */
export function extractJsonAfter(html: string, marker: string): unknown {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  const start = html.indexOf("{", at);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

type Json = Record<string, unknown>;

function get(o: unknown, ...path: (string | number)[]): unknown {
  let cur = o;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Json)[key as string];
  }
  return cur;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Every object under `root` that has `key`, depth first, in document order. */
function collect(root: unknown, key: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(root)) {
    for (const item of root) collect(item, key, out);
  } else if (root && typeof root === "object") {
    for (const [k, v] of Object.entries(root as Json)) {
      if (k === key) out.push(v);
      collect(v, key, out);
    }
  }
  return out;
}

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/** "137K Shorts" -> 137000 rounded · "1,204 Shorts" -> 1204 exact · "1 Short" -> 1. Null for anything else. */
export function parseShortsCount(text: string): Pick<YouTubeSourceReading, "usesCount" | "precision"> | null {
  const m = text.match(/^\s*(\d[\d.,]*)\s*([KMB])?\s+shorts?\s*$/i);
  if (!m) return null;
  const suffix = m[2]?.toLowerCase();
  if (suffix) {
    const n = Number.parseFloat(m[1].replace(/,/g, ""));
    if (!Number.isFinite(n)) return null;
    return { usesCount: Math.round(n * SUFFIX[suffix]), precision: "rounded" };
  }
  if (!/^\d{1,3}(,\d{3})*$|^\d+$/.test(m[1])) return null;
  return { usesCount: Number.parseInt(m[1].replace(/,/g, ""), 10), precision: "exact" };
}

function largestSource(sources: unknown): string | null {
  if (!Array.isArray(sources) || sources.length === 0) return null;
  const best = [...sources].sort(
    (a, b) => (Number(get(b, "width")) || 0) - (Number(get(a, "width")) || 0),
  )[0];
  return str(get(best, "url"));
}

export function parseYouTubeSourcePage(html: string, videoId?: string): YouTubeSourcePageResult {
  const data = extractJsonAfter(html, "ytInitialData");
  if (!data || typeof data !== "object") return { kind: "unreadable" };

  const header = get(data, "header", "pageHeaderRenderer");
  if (!header) return { kind: "not-found" };

  const model = get(header, "content", "pageHeaderViewModel");
  const title =
    str(get(model, "title", "dynamicTextViewModel", "text", "content")) ?? str(get(header, "pageTitle"));

  const rows = get(model, "metadata", "contentMetadataViewModel", "metadataRows");
  const parts = Array.isArray(rows) ? rows.flatMap((r) => (Array.isArray(get(r, "metadataParts")) ? (get(r, "metadataParts") as unknown[]) : [])) : [];

  let artist: string | null = null;
  let count: Pick<YouTubeSourceReading, "usesCount" | "precision"> | null = null;
  for (const part of parts) {
    const stackText = str(get(part, "avatarStack", "avatarStackViewModel", "text", "content"));
    if (stackText && !artist) artist = stackText;
    const text = str(get(part, "text", "content"));
    if (text && !count) count = parseShortsCount(text);
  }

  const coverImageUrl =
    largestSource(get(model, "image", "contentPreviewImageViewModel", "image", "sources")) ??
    (videoId && YOUTUBE_VIDEO_ID_RE.test(videoId) ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null);

  if (count) return { kind: "reading", reading: { ...count, title, artist, coverImageUrl } };

  /* No printed count: the grid is the count only when it is the whole list. */
  const contents = get(data, "contents");
  const continues = collect(contents, "continuationItemRenderer").length > 0;
  if (continues) return { kind: "no-count", title, artist, coverImageUrl };

  const ids = new Set<string>();
  for (const lockup of collect(contents, "shortsLockupViewModel")) {
    const id =
      str(get(lockup, "onTap", "innertubeCommand", "reelWatchEndpoint", "videoId")) ??
      str(get(lockup, "entityId"))?.replace(/^shorts-shelf-item-/, "") ??
      null;
    if (id) ids.add(id);
  }
  return { kind: "reading", reading: { usesCount: ids.size, precision: "exact", title, artist, coverImageUrl } };
}
