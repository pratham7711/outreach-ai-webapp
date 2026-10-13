import { db } from "@/lib/db";
import { loadImage } from "@/lib/media/loadImage";
import { createLogger } from "@/lib/observability/logger";
import { sharePostThumbnailPath } from "@/lib/postMedia";
/* The signed-link rules are the avatar store's, reused rather than restated:
   the CDNs that sign profile pictures are the ones that sign post covers, with
   the same `x-expires=` and hex `oe=` stamps and the same object keys. */
import { avatarImageKey as imageKey, isFetchableAvatarUrl as isFetchableImageUrl } from "@/lib/creators/avatarStore";

/**
 * Post pictures, kept as bytes.
 *
 * TikTok and Instagram hand out post covers on signed CDN paths that stop
 * answering within days, and each sync overwrites Post.thumbnailUrl with a
 * fresh one. That works while a campaign is being read. Once it stops, nothing
 * renews the link and the card goes blank: MEASURED on a read-only copy of
 * production on 2026-10-13, 217 of the 650 posts on client share links showed
 * the placeholder. So, as CreatorAvatar does for profile pictures, the moment a
 * sync sees a cover it is downloaded, shrunk to a WebP and kept in
 * PostThumbnail; every surface then reads it through our own route and the CDN
 * link stops mattering.
 *
 * YouTube is left alone: its covers live at a fixed address that never expires
 * (lib/postMedia#postThumbnailUrl), so a copy would be storage for nothing. So
 * are CreatorCore's imported pictures, which sit on its own permanent CDN.
 */

/**
 * Stored inside this box, whole -- "inside", not "cover", because each surface
 * crops it differently: a 9:16 grid tile, a near-square share card, a 3:2 post
 * header. 480 wide is the share card's 2x request (lib/postMedia, 478x490), the
 * widest any surface asks for, so nothing is painted from fewer pixels than it
 * gets today. MEASURED on the four Instagram covers on the demo campaign: 25-54
 * KB each at this box, against 17-32 KB at 360x640.
 */
export const THUMB_STORE_WIDTH = 480;
export const THUMB_STORE_HEIGHT = 854;

/**
 * The download's own clock. It runs inside a post sync, after the post's write
 * has landed, so a CDN that hangs must cost the sync a bounded wait rather than
 * the loader's 15 seconds. MEASURED from here: 14-76 ms per Instagram cover.
 */
export const THUMB_FETCH_TIMEOUT_MS = 5_000;

/** A picture that would not load is asked for again after this long, not on every sync. */
export const THUMB_RETRY_MS = 6 * 60 * 60 * 1000;

/** Only these platforms sign their covers, and only on these hosts. */
const PLATFORM_CDN: Record<string, RegExp> = {
  TIKTOK: /\.tiktokcdn(-us|-eu)?\.com$/,
  INSTAGRAM: /\.(cdninstagram\.com|fbcdn\.net)$/,
};

export function copiesThumbnails(platform: string): boolean {
  return platform in PLATFORM_CDN;
}

/**
 * Worth a copy: a TikTok or Instagram post, a link on that platform's own CDN,
 * https, and not past (or about to pass) its signature. Anything else -- a
 * YouTube cover, CreatorCore's Bubble CDN, a protocol-relative import -- is
 * left to the stored link.
 */
export function isCopyableThumbnailUrl(platform: string, url: string | null | undefined, nowMs = Date.now()): url is string {
  const cdn = PLATFORM_CDN[platform];
  if (!cdn || !isFetchableImageUrl(url, nowMs)) return false;
  try {
    return cdn.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Prisma's "table does not exist" -- the DDL has not been applied yet. */
export function isMissingThumbnailTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return code === "P2021" || /PostThumbnail.*does not exist|relation "PostThumbnail"/i.test(message);
}

export type StoredThumbnail = { data: Uint8Array; fetchedAt: Date | null };

/**
 * The stored picture for one post in one org, or null -- including when the
 * table is not there yet. `post` narrows further by the post's own row: the
 * share route uses it to hold a link to its own campaign, the dashboard route
 * to hold an assigned-campaigns seat to its campaigns.
 */
export async function readStoredThumbnail(
  postId: string,
  orgId: string,
  post?: Record<string, unknown>
): Promise<StoredThumbnail | null> {
  try {
    const row = await db.postThumbnail.findFirst({
      where: { postId, orgId, data: { not: null }, ...(post ? { post } : {}) },
      select: { data: true, fetchedAt: true },
    });
    return row?.data ? { data: row.data, fetchedAt: row.fetchedAt } : null;
  } catch (e) {
    if (isMissingThumbnailTable(e)) return null;
    throw e;
  }
}

/**
 * When each post's stored picture was taken, for the ones that have one. A
 * list puts it in the picture's URL, so a copy taken after the browser cached
 * a miss is fetched fresh.
 *
 * Never throws. A post list must not fail because of a decorative lookup: on
 * any error the list simply falls back to the stored links, which is exactly
 * today's behaviour.
 */
export async function storedThumbnailVersions(postIds: string[], orgId: string): Promise<Map<string, number>> {
  if (!postIds.length) return new Map();
  try {
    const rows = await db.postThumbnail.findMany({
      where: { orgId, postId: { in: postIds }, data: { not: null } },
      select: { postId: true, fetchedAt: true },
    });
    return new Map(rows.map((r) => [r.postId, r.fetchedAt?.getTime() ?? 0]));
  } catch (e) {
    if (!isMissingThumbnailTable(e)) {
      createLogger({ context: { module: "posts/thumbnailStore" } }).warn("thumbnail versions unavailable", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return new Map();
  }
}

/** The org a post belongs to, through its campaign -- the row has no orgId of its own. */
async function postOrgId(postId: string): Promise<string | null> {
  const post = await db.post.findUnique({ where: { id: postId }, select: { campaign: { select: { orgId: true } } } });
  return post?.campaign.orgId ?? null;
}

export type ThumbnailStoreResult = { stored: true; bytes: number } | { stored: false; failure: string };

/**
 * Download one URL and keep it. A failure never erases a picture already held
 * -- a post whose new link is dead keeps showing the last good one -- but it is
 * recorded, so the next sync does not ask again for THUMB_RETRY_MS.
 */
export async function storeThumbnailFromUrl(
  post: { id: string; orgId?: string | null },
  url: string,
  options: { timeoutMs?: number } = {}
): Promise<ThumbnailStoreResult> {
  const loaded = await loadImage(url, THUMB_STORE_WIDTH, THUMB_STORE_HEIGHT, "posts/thumbnailStore", {
    fit: "inside",
    timeoutMs: options.timeoutMs ?? THUMB_FETCH_TIMEOUT_MS,
  });
  try {
    const orgId = post.orgId ?? (await postOrgId(post.id));
    if (!orgId) return { stored: false, failure: "post not found" };
    const now = new Date();
    /* WebP only. loadImage hands back the CDN's own bytes when it cannot
       transcode them, and those are neither bounded by the box above nor
       something every browser decodes. */
    if (loaded.ok && loaded.contentType === "image/webp") {
      const data = new Uint8Array(loaded.body);
      await db.postThumbnail.upsert({
        where: { postId: post.id },
        create: { postId: post.id, orgId, data, sourceUrl: url, fetchedAt: now },
        update: { data, sourceUrl: url, fetchedAt: now, failedAt: null, failure: null },
      });
      return { stored: true, bytes: data.byteLength };
    }
    const failure = loaded.ok ? `not transcoded (${loaded.contentType})` : loaded.message;
    await recordThumbnailFailure(post.id, orgId, failure);
    return { stored: false, failure };
  } catch (e) {
    if (isMissingThumbnailTable(e)) return { stored: false, failure: "table missing" };
    throw e;
  }
}

/** Keeps whatever picture is already held; only the failure is written. */
export async function recordThumbnailFailure(postId: string, orgId: string, failure: string): Promise<void> {
  const now = new Date();
  try {
    await db.postThumbnail.upsert({
      where: { postId },
      create: { postId, orgId, failedAt: now, failure },
      update: { failedAt: now, failure },
    });
  } catch (e) {
    if (!isMissingThumbnailTable(e)) throw e;
  }
}

/**
 * Called by every post sync that has just written a cover link
 * (lib/sync/syncPost#applyPostMetrics). Downloads only when there is something
 * new to keep: no copy yet, or a different picture (a new image key -- the
 * signature and host change on every read, the key does not). The same cover
 * seen again costs one primary-key read and no download, so a post synced
 * hourly pays for its picture once.
 *
 * Never throws and never fails the sync: the post's write has already landed
 * by the time this runs, and a picture is not worth losing a reading over.
 */
export async function capturePostThumbnail(
  post: { id: string; platform: string },
  url: string | null | undefined,
  nowMs = Date.now()
): Promise<boolean> {
  if (!isCopyableThumbnailUrl(post.platform, url, nowMs)) return false;
  const started = Date.now();
  try {
    /* fetchedAt, not data, says a copy is held: only a successful store sets
       it. Selecting the bytes to test them would pull 25-54 KB out of the
       database on every sync of every post, to throw away. */
    const row = await db.postThumbnail.findUnique({
      where: { postId: post.id },
      select: { orgId: true, fetchedAt: true, sourceUrl: true, failedAt: true },
    });
    const key = imageKey(url);
    if (row?.fetchedAt && key !== null && imageKey(row.sourceUrl) === key) return false;
    if (row?.failedAt && nowMs - row.failedAt.getTime() < THUMB_RETRY_MS) return false;

    const result = await storeThumbnailFromUrl({ id: post.id, orgId: row?.orgId }, url);
    createLogger({ context: { module: "posts/thumbnailStore" } }).info("post thumbnail capture", {
      postId: post.id,
      platform: post.platform,
      stored: result.stored,
      ...(result.stored ? { bytes: result.bytes } : { failure: result.failure }),
      ms: Date.now() - started,
    });
    return result.stored;
  } catch (e) {
    if (!isMissingThumbnailTable(e)) {
      createLogger({ context: { module: "posts/thumbnailStore" } }).warn("post thumbnail capture failed", {
        postId: post.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return false;
  }
}

/**
 * The share report's post rows, pointing at our stored copies where there are
 * any (lib/postMedia#sharePostThumbnailPath), through the token-scoped route.
 *
 * Applied after redactForShare and outside the report's cache: the cache is
 * keyed by the posts' own state, which a newly stored picture does not move, so
 * a copy taken after the report was cached would otherwise wait out the entry.
 *
 * Nothing on a link that hides creators. redactForShare strips the thumbnail
 * there because a cover identifies the creator, and the route refuses those
 * links too; this keeps the payload from naming a picture it cannot load.
 */
export async function withStoredShareThumbnails<T extends { posts: { id: string; thumbnailUrl: string | null }[] }>(
  data: T,
  share: { token: string; orgId: string; showCreators: boolean }
): Promise<T> {
  if (!share.showCreators || data.posts.length === 0) return data;
  const versions = await storedThumbnailVersions(data.posts.map((p) => p.id), share.orgId);
  if (versions.size === 0) return data;
  return {
    ...data,
    posts: data.posts.map((p) => {
      const v = versions.get(p.id);
      return v === undefined ? p : { ...p, thumbnailUrl: sharePostThumbnailPath(share.token, p.id, v) };
    }),
  };
}
