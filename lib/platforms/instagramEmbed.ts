import { createLogger } from "../observability/logger";
import { shortcodeFromUrl } from "./instagram";

const log = createLogger({ context: { platform: "INSTAGRAM", source: "embed" } });

/**
 * The last Instagram surface that still answers without a credential.
 *
 * Every documented public endpoint is now closed. Measured 2026-09-02, from a
 * residential address AND from a Vercel Sandbox, both getting the same answer:
 *
 *   api/v1/users/web_profile_info/     400 "useragent mismatch", or
 *                                      401 require_login with an app UA
 *   graphql/query?query_hash=b3055c..  401 require_login, igweb_rollout
 *   api/v1/media/shortcode/{sc}/info/  404
 *   api.instagram.com/oembed           500 -- the old last-resort path, dead
 *   /p/{sc}/ and /p/{sc}/embed/        623KB login shell, zero counters
 *
 * What does answer is the CAPTIONED EMBED, and only when the request looks like
 * an actual <iframe> load -- a referer plus the three sec-fetch headers a
 * browser sends for a cross-site frame navigation. Without them the same URL
 * returns the login shell; with them it returns a 262KB page carrying a
 * "contextJSON" blob with the real gql payload inside.
 *
 * This is a scrape of an undocumented shape, so it is the LAST link in the
 * chain and it is never allowed to overwrite an official figure. It exists
 * because Business Discovery drops like_count whenever a creator hides their
 * likes, and reads only a creator's newest 100 media -- so without a fallback
 * those posts are unmeasurable rather than merely unmeasured.
 */
export type InstagramEmbedPost = {
  shortcode: string;
  caption: string | null;
  thumbnailUrl: string | null;
  /**
   * Present only when the embed reported a POSITIVE like count.
   *
   * Zero from this field does not mean zero likes -- it means the creator hid
   * them. Measured across the three production posts: the two whose embed said
   * `edge_liked_by.count === 0` are exactly the two whose like_count Business
   * Discovery also withheld, and the one that reported 1428 matched Business
   * Discovery's 1428 to the digit. So a positive number here is trustworthy and
   * a zero is an absence wearing a number's clothes.
   *
   * Writing that zero through would recreate, from a new source, the precise
   * bug this whole chain was rebuilt to kill: a hidden counter stored as a
   * measured 0 and reported to a client as "no likes".
   */
  likesCount?: number;
  commentsCount?: number;
  authorFollowers?: number;
  authorHandle?: string;
  /** True when the embed answered but reported likes as 0, i.e. hidden. */
  likesHidden: boolean;
  /**
   * What the embed claims for plays -- deliberately NOT surfaced as viewsCount.
   *
   * Measured on DcQFHR5pdYw: the embed says 3337 where Business Discovery says
   * 24245 for the same post at the same moment. That is not staleness, it is a
   * different quantity, and we have no way to tell which posts it under-reports
   * by 7x. A view count that is wrong by an unknown factor is worse than none,
   * so this is carried for diagnostics only.
   */
  embedViewCount?: number;
  /** Instagram's own flag that the media is copyright-restricted. */
  copyrightBlocked: boolean;
};

const CONTEXT_KEY = '"contextJSON":';

/**
 * Pull the JSON string literal that follows "contextJSON": and decode it.
 *
 * Scanned by hand rather than by regex: the literal runs to ~100KB and a
 * backtracking alternation over that is a liability in a request path. This
 * walks it once, honouring backslash escapes, and stops at the closing quote.
 */
function extractContextJson(html: string): unknown | null {
  const at = html.indexOf(CONTEXT_KEY);
  if (at < 0) return null;

  let i = at + CONTEXT_KEY.length;
  while (i < html.length && (html[i] === " " || html[i] === "\n")) i++;
  if (html[i] !== '"') return null;

  const start = i;
  i++;
  while (i < html.length) {
    const ch = html[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === '"') {
      const literal = html.slice(start, i + 1);
      try {
        // Two decodes: the literal is a JSON string whose CONTENT is JSON.
        return JSON.parse(JSON.parse(literal) as string);
      } catch {
        return null;
      }
    }
    i++;
  }
  return null;
}

function positive(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Read a captioned-embed page. Pure, so the shape it depends on is testable
 * against a captured fixture instead of against Instagram's mood.
 */
export function parseInstagramEmbed(html: string): InstagramEmbedPost | null {
  const context = extractContextJson(html);
  if (!context || typeof context !== "object") return null;

  const ctx = context as Record<string, any>;
  const media = ctx.gql_data?.shortcode_media;
  if (!media || typeof media !== "object") return null;

  const shortcode = typeof media.shortcode === "string" ? media.shortcode : "";
  if (!shortcode) return null;

  /* Two like fields exist and they are not interchangeable. edge_media_preview_like
     was null on all three measured posts; edge_liked_by carried the real number.
     Prefer whichever is positive rather than trusting one to be present. */
  const likeCandidates = [
    nonNegative(media.edge_liked_by?.count),
    nonNegative(media.edge_media_preview_like?.count),
  ].filter((n): n is number => typeof n === "number");
  const bestLike = likeCandidates.length > 0 ? Math.max(...likeCandidates) : undefined;

  const caption =
    media.edge_media_to_caption?.edges?.[0]?.node?.text ??
    (typeof media.accessibility_caption === "string" ? media.accessibility_caption : null);

  return {
    shortcode,
    caption: typeof caption === "string" && caption.length > 0 ? caption : null,
    thumbnailUrl:
      (typeof media.thumbnail_src === "string" && media.thumbnail_src) ||
      (typeof media.display_url === "string" && media.display_url) ||
      null,
    ...(typeof bestLike === "number" && bestLike > 0 ? { likesCount: bestLike } : {}),
    likesHidden: bestLike === 0,
    ...(nonNegative(media.edge_media_to_comment?.count) !== undefined
      ? { commentsCount: nonNegative(media.edge_media_to_comment?.count) }
      : {}),
    ...(positive(media.owner?.edge_followed_by?.count) !== undefined
      ? { authorFollowers: positive(media.owner?.edge_followed_by?.count) }
      : {}),
    ...(typeof media.owner?.username === "string" ? { authorHandle: media.owner.username } : {}),
    ...(positive(media.video_view_count) !== undefined
      ? { embedViewCount: positive(media.video_view_count) }
      : {}),
    copyrightBlocked: Boolean(ctx.context?.copyright_blocked),
  };
}

/*
 * The headers are the whole trick, so they are named rather than inlined.
 *
 * Drop the referer or any one of the three sec-fetch values and Instagram
 * serves the login shell instead -- a 623KB page with no counters that parses
 * to null. It is not an auth check we are evading; it is that the embed only
 * renders for a request shaped like the cross-site iframe load it was built to
 * serve.
 */
const EMBED_HEADERS: Record<string, string> = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  referer: "https://www.instagram.com/",
  "sec-fetch-dest": "iframe",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "cross-site",
};

export async function fetchInstagramEmbedPost(
  url: string,
  signal?: AbortSignal,
): Promise<InstagramEmbedPost | null> {
  const shortcode = shortcodeFromUrl(url);
  if (!shortcode) return null;

  try {
    const res = await fetch(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, {
      headers: EMBED_HEADERS,
      signal,
    });
    if (!res.ok) {
      log.warn("instagram embed refused", { shortcode, status: res.status });
      return null;
    }
    const html = await res.text();
    const parsed = parseInstagramEmbed(html);
    if (!parsed) {
      /* Size is the tell worth logging: ~262KB is the real embed, ~623KB is the
         login shell. Without it a null here is indistinguishable from a shape
         change, and those need different fixes. */
      log.warn("instagram embed carried no post payload", {
        shortcode,
        bytes: html.length,
        loginWall: html.includes("Sorry, this page isn't available") || html.length > 400_000,
      });
      return null;
    }
    return parsed;
  } catch (error) {
    log.warn("instagram embed fetch failed", {
      shortcode,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
