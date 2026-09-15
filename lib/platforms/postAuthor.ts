import type { Platform } from "@/lib/generated/prisma/client";
import { createLogger } from "@/lib/observability/logger";
import { fetchInstagramEmbedPost } from "@/lib/platforms/instagramEmbed";

/**
 * Who posted this, asked of the platform rather than of the operator.
 *
 * Adding a post only ever needed a creator because `Post.creatorId` is
 * required, and the roster row is what makes the numbers mean anything -- per
 * creator views and spend, payout maths, the campaign's Creators tab, and the
 * connected token a real metrics read goes through. None of that is a reason to
 * make somebody TYPE it: the post names its own author, and where the platform
 * will say so we should ask the platform.
 *
 * What each platform actually gives us, MEASURED 2026-09-15 from this network:
 *
 *   TikTok     The URL always carries it -- /@handle/video/123 -- so nothing
 *              here is needed and nothing here is called.
 *   YouTube    youtube.com/oembed answers with author_name and author_url
 *              ("https://www.youtube.com/@danikmma_1") for both /shorts/ID and
 *              /watch?v=ID, with NO api key. That is this function's whole job.
 *   Instagram  The captioned embed names the owner, and this app already
 *              reads it: fetchInstagramEmbedPost returns authorHandle off the
 *              same page the metrics chain scrapes. MEASURED 2026-09-15 on four
 *              stored reels -- three answered with exactly the handle already on
 *              the roster row (iamswarat, danikmma1, the_cinematic.01) and the
 *              fourth is a deleted post, whose embed says so in words ("the
 *              post may have been removed") and carries "contextJSON":null.
 *              The documented public endpoints are all still shut --
 *              graph.facebook.com/instagram_oembed answers `(#200) Provide
 *              valid app ID` with or without a fields list -- so the embed is
 *              the only source, and a deleted post is still a manual pick.
 *
 * Never throws and never blocks for long. A platform that will not answer
 * leaves the caller exactly where it was -- asking.
 */

export type PostAuthor = {
  /** Without the leading "@", the spelling the roster stores. */
  handle: string;
  /** The platform's display name, when it gave one. */
  name: string | null;
};

const TIMEOUT_MS = 6000;

/* AbortSignal.timeout is absent under jsdom, and reading it off the class
   unguarded throws — which this module then swallows as "the platform would not
   answer", so every test of it passed by failing. Same guard idiom as
   notifications.ts and fetchPostMetrics.ts. */
function timeoutSignal(ms: number): AbortSignal | undefined {
  const t = (AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal }).timeout;
  return typeof t === "function" ? t.call(AbortSignal, ms) : undefined;
}

export async function resolveAuthorFromPlatform(
  url: string,
  platform: Platform | null | undefined,
): Promise<PostAuthor | null> {
  if (platform === "YOUTUBE") return youtubeAuthor(url);
  if (platform === "INSTAGRAM") return instagramAuthor(url);
  return null;
}

/**
 * Instagram gives a handle and no display name, which is the whole answer: the
 * handle is what the roster matches on, and inventing a name from it would put
 * a made-up string in front of the operator as if the platform had said it.
 */
async function instagramAuthor(url: string): Promise<PostAuthor | null> {
  const log = createLogger({ context: { platform: "INSTAGRAM", call: "embed.author" } });
  try {
    const post = await fetchInstagramEmbedPost(url, timeoutSignal(TIMEOUT_MS));
    const handle = post?.authorHandle?.trim().replace(/^@/, "");
    return handle ? { handle, name: null } : null;
  } catch (err) {
    log.debug("instagram embed author lookup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function youtubeAuthor(url: string): Promise<PostAuthor | null> {
  const log = createLogger({ context: { platform: "YOUTUBE", call: "oembed.author" } });
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`,
      { signal: timeoutSignal(TIMEOUT_MS) },
    );
    // 401/404 here is YouTube saying the video is private or gone, which is a
    // settled answer and not worth a retry or a log line at error level.
    if (!res.ok) return null;
    const data = (await res.json()) as { author_name?: unknown; author_url?: unknown };
    const handle = handleFromChannelUrl(data.author_url);
    if (!handle) return null;
    return {
      handle,
      name: typeof data.author_name === "string" && data.author_name.trim() ? data.author_name.trim() : null,
    };
  } catch (err) {
    log.debug("youtube oembed author lookup failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Only the "@handle" form of a channel URL.
 *
 * YouTube also publishes /channel/UC… and the long-dead /user/… and /c/… forms,
 * and none of those is a handle -- a UC id stored in Creator.handle would never
 * match the same creator arriving any other way, which is the duplicate-roster
 * problem this app already has ten rows of. No handle is a better answer than a
 * handle that cannot be matched.
 */
function handleFromChannelUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.match(/youtube\.com\/@([A-Za-z0-9._-]{1,100})/);
  return m ? m[1] : null;
}
