import { rankTopPosts, type TopPost } from "./creatorProfile";

/**
 * A TikTok creator's own videos, from the page TikTok publishes for embedding.
 *
 * `https://www.tiktok.com/embed/@handle` server-renders a `videoList` array
 * into its HTML: id, description, cover image and `playCount` for each of the
 * creator's recent videos. It exists so other sites can embed a profile, which
 * is exactly why it is reachable where the app's own grid is not — no signing
 * params, no browser, one HTTP request.
 *
 * That matters because `/api/post/item_list/` is the endpoint everything else
 * failed against: 200 with a zero-byte body from Vercel egress under headless
 * Chromium, new-headless google-chrome, and headed google-chrome under Xvfb
 * alike (all measured 2026-09-01). This route sidesteps that question rather
 * than answering it.
 *
 * Measured the same day, curled from a Vercel Sandbox (iad1):
 *   @sonheii    13 videos, top playCount 28,500,000
 *   @khaby.lame 10 videos, top playCount 59,600,000
 *   @zachking   11 videos, top playCount 65,500,000
 *   @.olise.ftbl / @oliseftbl_  no videoList — the handle does not resolve
 *
 * Every item carries `authorUniqueId`, and this parser drops any row where it
 * is not the creator asked for. That check is not decoration: the sibling
 * endpoint `/api/repost/item_list/` returns a creator's REPOSTS, authored by
 * other people, and reading those as their own top posts is a mistake this
 * codebase has already made once. Verify authorship, always.
 *
 * What the embed does NOT carry: like and comment counts, and post dates.
 * Those stay null rather than being guessed at.
 */

export type EmbedTopPostsRead = {
  topPosts: TopPost[];
  /** Mean views across every video the embed listed, not just the ranked ones. */
  avgViews: number;
  sampledPosts: number;
};

type EmbedVideo = {
  id?: unknown;
  desc?: unknown;
  coverUrl?: unknown;
  playCount?: unknown;
  authorUniqueId?: unknown;
};

/** The one array in the page worth having, extracted without a DOM. */
function extractVideoList(html: string): EmbedVideo[] | null {
  const key = html.indexOf('"videoList":[');
  if (key < 0) return null;
  const start = html.indexOf("[", key);
  /* Bracket-matched rather than regex-matched: descriptions contain brackets,
     and a lazy pattern truncates the list at the first one. */
  let depth = 0;
  let end = -1;
  for (let i = start; i < html.length; i += 1) {
    const c = html[i];
    if (c === '"') {
      /* Skip the string wholesale so its contents cannot move the depth. */
      i += 1;
      while (i < html.length && html[i] !== '"') i += html[i] === "\\" ? 2 : 1;
      continue;
    }
    if (c === "[") depth += 1;
    else if (c === "]") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  if (end < 0) return null;
  try {
    const parsed = JSON.parse(html.slice(start, end));
    return Array.isArray(parsed) ? (parsed as EmbedVideo[]) : null;
  } catch {
    return null;
  }
}

const asCount = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v) : null;

/**
 * @returns null when the page carried no video list at all — a handle that does
 *   not resolve, or a shape change. An empty array is a real answer: a live
 *   handle with nothing embeddable.
 */
export function parseTikTokEmbedVideoList(html: string, handle: string): TopPost[] | null {
  const clean = handle.replace(/^@/, "").trim().toLowerCase();
  const videos = extractVideoList(html);
  if (!videos) return null;

  return videos
    .filter((v) => {
      if (typeof v?.id !== "string" || !v.id) return false;
      const author = typeof v.authorUniqueId === "string" ? v.authorUniqueId.toLowerCase() : "";
      /* No author, no claim. An unattributed row cannot be shown as theirs. */
      return author !== "" && author === clean;
    })
    .map((v) => ({
      postId: String(v.id),
      url: `https://www.tiktok.com/@${clean}/video/${String(v.id)}`,
      caption: typeof v.desc === "string" && v.desc ? v.desc : null,
      coverUrl: typeof v.coverUrl === "string" && v.coverUrl ? v.coverUrl : null,
      views: asCount(v.playCount),
      /* The embed carries neither, and a zero here would read as a measured
         zero on a video with millions of views. */
      likes: null,
      comments: null,
      postedAt: null,
    }));
}

/**
 * @param fetchHtml how to get the embed page — a direct fetch on the app's own
 *   egress, or a curl from somewhere TikTok answers. Injected so this module
 *   stays free of the sandbox SDK.
 * @returns null when nothing could be read; the caller treats that as "not
 *   measured" and leaves stored posts alone.
 */
export async function readTikTokTopPostsEmbed(
  handle: string,
  fetchHtml: (handle: string) => Promise<string | null>
): Promise<EmbedTopPostsRead | null> {
  const html = await fetchHtml(handle).catch(() => null);
  if (!html) return null;

  const posts = parseTikTokEmbedVideoList(html, handle);
  if (!posts?.length) return null;

  const views = posts.map((p) => p.views).filter((v): v is number => typeof v === "number");
  return {
    topPosts: rankTopPosts(posts),
    avgViews: views.length ? views.reduce((a, b) => a + b, 0) / views.length : 0,
    sampledPosts: views.length,
  };
}

/** The embed URL, in one place so the reader and the sandbox curl cannot drift. */
export function tikTokEmbedUrl(handle: string): string {
  return `https://www.tiktok.com/embed/@${encodeURIComponent(handle.replace(/^@/, "").trim())}`;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/**
 * The embed page over the app's own egress.
 *
 * Worth trying before anything is booted: the profile page is served a WAF
 * login shell from here, but the embed page is meant for third parties and may
 * not be behind the same wall. Cheap to ask, and it costs one request to find
 * out per creator. Returns null on anything that is not usable HTML, so the
 * caller falls through to an egress TikTok definitely answers.
 */
export async function fetchTikTokEmbedHtmlDirect(handle: string): Promise<string | null> {
  try {
    const res = await fetch(tikTokEmbedUrl(handle), {
      headers: {
        "user-agent": UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    /* A WAF shell is HTTP 200 too. The list is the only proof that matters. */
    return html.includes('"videoList":[') ? html : null;
  } catch {
    return null;
  }
}
