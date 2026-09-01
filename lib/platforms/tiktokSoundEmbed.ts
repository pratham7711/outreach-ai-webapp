import type { TikTokSoundStats } from "./tiktokSound";

/**
 * A TikTok sound's use count from the music EMBED page.
 *
 * scripts/sound-worker/README.md explains, correctly, why this job could not run
 * on Vercel: the music page carries no count, and `/api/music/detail/` answers
 * 200 with an empty body unless the request is signed with `X-Bogus`,
 * `X-Gnarly`, `X-Dynosaur` and `msToken`, which TikTok's own client script
 * generates while the page loads. A server cannot forge them, so the reader had
 * to be a real browser on a box outside India.
 *
 * That is still true of the music page and the detail API. It is NOT true of the
 * embed page. `https://www.tiktok.com/embed/music/<id>` server-renders an
 * `embedInfo` object with the count in it (measured 2026-09-01 from a Vercel
 * Sandbox in iad1):
 *
 *   "embedInfo":{"coverUrl":"https://p19-common.tiktokcdn-us.com/...",
 *                "artist":"Ellie Holcomb","videoCount":44,
 *                "id":"7546394810303694849","statusCode":0,"code":200}
 *
 * 44 is exactly the figure the tracked sound was holding. Same shape of win as
 * TikTok Top Posts, which the creator profile embed rescued the same way, and it
 * costs one HTTPS request rather than a VPS.
 *
 * The measured sample is ONE real sound plus two ids that do not exist, so the
 * parser is deliberately strict rather than clever. A bogus id returns a 239KB
 * generic shell with no `embedInfo` at all, which is a clean tell; anything that
 * is not an `embedInfo` carrying `statusCode: 0` and a finite `videoCount` is
 * treated as "not measured" and returns null. A reader that cannot distinguish
 * the two would eventually write someone else's number into a client's report,
 * which is the mistake reposts nearly caused on the Top Posts side.
 */

/** `videoCount` is TikTok's name for it; ours is usesCount. Same number. */
type EmbedInfo = {
  videoCount?: unknown;
  artist?: unknown;
  coverUrl?: unknown;
  id?: unknown;
  statusCode?: unknown;
};

export function tikTokMusicEmbedUrl(tiktokSoundId: string): string {
  return `https://www.tiktok.com/embed/music/${encodeURIComponent(tiktokSoundId)}`;
}

/**
 * Pull the `embedInfo` object out of the page.
 *
 * Bracket-matched rather than regex-captured, and it steps over string contents,
 * because an artist name is free text and may hold a brace. The same lesson the
 * Top Posts embed parser learned from captions.
 */
function extractEmbedInfo(html: string): EmbedInfo | null {
  const key = '"embedInfo":';
  const at = html.indexOf(key);
  if (at < 0) return null;

  let i = html.indexOf("{", at + key.length);
  if (i < 0) return null;

  const start = i;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1)) as EmbedInfo;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim() ? v : null;

/**
 * @param expectedId when given, the embed must be for this sound. TikTok echoes
 *   the id back, and a page for a different sound is a wrong answer rather than
 *   a missing one — worth refusing outright.
 * @returns null when the page carried no usable count. `title` is always null:
 *   the embed names the artist but not the track, so the caller must not treat
 *   this as evidence the stored title is wrong.
 */
export function parseTikTokMusicEmbed(
  html: string,
  expectedId?: string
): TikTokSoundStats | null {
  const info = extractEmbedInfo(html);
  if (!info) return null;

  /* statusCode 0 is TikTok's "this resolved". Anything else — a deleted sound,
     a region refusal — is not a zero-use sound, it is no reading. */
  if (Number(info.statusCode) !== 0) return null;

  if (expectedId && str(info.id) && String(info.id) !== String(expectedId)) return null;

  const uses = Number(info.videoCount);
  if (!Number.isFinite(uses) || uses < 0) return null;

  return {
    usesCount: Math.round(uses),
    // The embed carries the artist and cover, never the track title.
    title: null,
    artist: str(info.artist),
    coverImageUrl: str(info.coverUrl),
  };
}

/**
 * Try the embed over plain egress.
 *
 * Kept separate from the sandbox path, and tried first, because when it works it
 * costs one fetch. It returns null unless the body actually contains an
 * `embedInfo` — a WAF shell and a region placeholder are both HTTP 200, so the
 * status code proves nothing on its own.
 */
export async function fetchTikTokMusicEmbedHtmlDirect(
  tiktokSoundId: string,
  timeoutMs = 15_000
): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(tikTokMusicEmbedUrl(tiktokSoundId), {
      headers: {
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "accept-language": "en-US,en;q=0.9",
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    const html = await res.text();
    return html.includes('"embedInfo":') ? html : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The full read: plain egress first, then whatever fallback the caller supplies
 * (in practice the Vercel Sandbox curl, which is where this was measured).
 */
export async function readTikTokSoundViaEmbed(
  tiktokSoundId: string,
  fallbackHtml?: (id: string) => Promise<string | null>
): Promise<TikTokSoundStats | null> {
  const direct = await fetchTikTokMusicEmbedHtmlDirect(tiktokSoundId);
  const fromDirect = direct ? parseTikTokMusicEmbed(direct, tiktokSoundId) : null;
  if (fromDirect) return fromDirect;

  if (!fallbackHtml) return null;
  const remote = await fallbackHtml(tiktokSoundId).catch(() => null);
  return remote ? parseTikTokMusicEmbed(remote, tiktokSoundId) : null;
}
