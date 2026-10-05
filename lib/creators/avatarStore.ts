import { db } from "@/lib/db";
import { loadImage } from "@/lib/media/loadImage";
import { readCreatorProfile, type CreatorReadResult } from "@/lib/platforms/creatorProfile";
import { TRACKER_SWEEP_STOP_PERCENT } from "@/lib/platforms/instagramDiscoveryTokens";
import { createLogger } from "@/lib/observability/logger";
import { UNATTRIBUTED_CREATOR_WHERE } from "@/lib/posts/unattributedCreator";

/**
 * Creator profile pictures, kept as bytes.
 *
 * TikTok and Instagram hand out profile pictures on signed CDN paths
 * (`x-expires=` on TikTok, a hex `oe=` on Meta) that stop answering within days
 * and cannot be revived by stripping the signature. A stored URL is therefore a
 * picture with a shelf life, which is why rosters imported weeks ago render
 * initials. So the moment a fresh URL is seen it is downloaded, re-encoded to a
 * small WebP and written to CreatorAvatar; every surface reads it back through
 * /api/creators/[id]/avatar and never touches the CDN link again.
 *
 * Fresh URLs arrive from three places: the creator tracker's profile reads
 * (captured in snapshot.ts), a post's authorProfilePic, and the hourly refresh
 * pass below for everyone the tracker never reads.
 */

/** Stored at this square box; the serving route shrinks it per request. */
export const AVATAR_STORE_PX = 256;
/** People change their picture; re-read one this old. */
export const AVATAR_STALE_MS = 14 * 24 * 60 * 60 * 1000;
/** A creator with nothing readable is retried weekly, not every run. */
export const AVATAR_RETRY_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * How a rate-limited read used to be recorded. Those rows are due again at
 * once rather than after AVATAR_RETRY_MS: the platform was busy, the creator
 * was fine.
 */
const RATE_LIMITED_FAILURE = "profile read: rate-limited";

/** A signature this close to expiry is treated as already expired. */
const EXPIRY_MARGIN_S = 10 * 60;

/** Unix seconds a signed CDN URL stops answering, or null when unsigned. */
export function signedUrlExpiry(url: string): number | null {
  const tiktok = /[?&]x-expires=(\d+)/.exec(url);
  if (tiktok) return Number(tiktok[1]);
  const meta = /[?&]oe=([0-9A-Fa-f]{6,})/.exec(url);
  if (meta) return parseInt(meta[1], 16);
  return null;
}

/** Worth a download: https, and not past (or about to pass) its signature. */
export function isFetchableAvatarUrl(url: string | null | undefined, nowMs = Date.now()): url is string {
  if (!url || !url.startsWith("https://")) return false;
  const expiry = signedUrlExpiry(url);
  return expiry === null || expiry - EXPIRY_MARGIN_S > nowMs / 1000;
}

/** Prisma's "table does not exist" -- the DDL has not been applied yet. */
function isMissingTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return code === "P2021" || /CreatorAvatar.*does not exist|relation "CreatorAvatar"/i.test(message);
}

export type StoredAvatar = { data: Uint8Array; fetchedAt: Date | null };

/** The stored picture, or null -- including when the table is not there yet. */
export async function readStoredAvatar(creatorId: string, orgId: string): Promise<StoredAvatar | null> {
  try {
    const row = await db.creatorAvatar.findFirst({
      where: { creatorId, orgId, data: { not: null } },
      select: { data: true, fetchedAt: true },
    });
    return row?.data ? { data: row.data, fetchedAt: row.fetchedAt } : null;
  } catch (e) {
    if (isMissingTable(e)) return null;
    throw e;
  }
}

/**
 * When each creator's stored picture was taken, for the ones that have one.
 * A list page puts it in the picture's URL, so a picture stored after the
 * browser cached a 404 for that creator is fetched fresh instead of waiting
 * out the hour.
 */
export async function storedAvatarVersions(creatorIds: string[], orgId: string): Promise<Map<string, number>> {
  if (!creatorIds.length) return new Map();
  try {
    const rows = await db.creatorAvatar.findMany({
      where: { orgId, creatorId: { in: creatorIds }, data: { not: null } },
      select: { creatorId: true, fetchedAt: true },
    });
    return new Map(rows.map((r) => [r.creatorId, r.fetchedAt?.getTime() ?? 0]));
  } catch (e) {
    if (isMissingTable(e)) return new Map();
    throw e;
  }
}

/**
 * Download one URL and keep it. Returns whether a picture is now stored from it.
 * A failure never erases a picture already held -- a creator whose new link is
 * dead keeps showing the last good one.
 */
export async function storeAvatarFromUrl(creatorId: string, orgId: string, url: string): Promise<boolean> {
  if (!isFetchableAvatarUrl(url)) return false;
  const loaded = await loadImage(url, AVATAR_STORE_PX, AVATAR_STORE_PX, "creators/avatarStore");
  try {
    if (loaded.ok && loaded.contentType === "image/webp") {
      const now = new Date();
      const data = new Uint8Array(loaded.body);
      await db.creatorAvatar.upsert({
        where: { creatorId },
        create: { creatorId, orgId, data, sourceUrl: url, fetchedAt: now },
        update: { data, sourceUrl: url, fetchedAt: now, failedAt: null, failure: null },
      });
      return true;
    }
    return false;
  } catch (e) {
    if (isMissingTable(e)) return false;
    throw e;
  }
}

async function recordFailure(creatorId: string, orgId: string, failure: string) {
  const now = new Date();
  try {
    await db.creatorAvatar.upsert({
      where: { creatorId },
      create: { creatorId, orgId, failedAt: now, failure },
      update: { failedAt: now, failure },
    });
  } catch (e) {
    if (!isMissingTable(e)) throw e;
  }
}

/**
 * What names the picture itself in a CDN link, apart from the host, size and
 * signature that change from read to read. TikTok serves one picture from
 * several hosts and regions with the same object key before its `~` options
 * (measured: 69 of 70 profiles kept one key across nine reads through
 * different lanes); Google puts the size after `=`; Meta keeps one file name.
 * A new picture is a new key. Null when the link has no recognisable key.
 */
export function avatarImageKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { hostname, pathname } = new URL(url);
    const last = pathname.split("/").pop() ?? "";
    if (/tiktokcdn/.test(hostname)) return last.split("~")[0] || null;
    if (/ggpht\.com$|googleusercontent\.com$/.test(hostname)) return pathname.split("=")[0] || null;
    return last || null;
  } catch {
    return null;
  }
}

/**
 * Called wherever a profile read has just seen a fresh picture URL. Downloads
 * when nothing is stored, when the creator has changed their picture (a new
 * image key), or when the stored copy is a fortnight old. The same picture
 * seen again costs nothing, so the tracker's reads cost an image fetch only
 * when there is a new picture to keep.
 */
export async function captureLatestAvatar(
  creator: { id: string; orgId: string },
  url: string | null | undefined,
  nowMs = Date.now()
): Promise<boolean> {
  if (!isFetchableAvatarUrl(url, nowMs)) return false;
  try {
    const row = await db.creatorAvatar.findUnique({
      where: { creatorId: creator.id },
      select: { fetchedAt: true, data: true, sourceUrl: true },
    });
    const key = avatarImageKey(url);
    const samePicture = key !== null && avatarImageKey(row?.sourceUrl) === key;
    if (row?.data && row.fetchedAt && samePicture && nowMs - row.fetchedAt.getTime() < AVATAR_STALE_MS) return false;
  } catch (e) {
    if (isMissingTable(e)) return false;
    throw e;
  }
  return storeAvatarFromUrl(creator.id, creator.orgId, url);
}

export type AvatarRefreshCounts = { considered: number; stored: number; failed: number; skipped: number };

/**
 * The hourly pass: every creator with no picture, or one older than
 * AVATAR_STALE_MS, newest first, bounded by `limit` and a clock.
 *
 * Cheapest source first. The links we already hold cost one image fetch and
 * no platform call; only when none of them is still live does it read the
 * profile, and a TikTok profile only reaches the sandbox when a plain fetch
 * gets the WAF shell. Cross-org by design, like every cron: each row carries
 * its own orgId and the picture is written under it.
 */
export async function refreshCreatorAvatars({
  limit = 150,
  deadlineMs = 4 * 60 * 1000,
  concurrency = 1,
  readTikTokProfileRemote,
  nowMs = Date.now(),
}: {
  limit?: number;
  deadlineMs?: number;
  /** Creators worked on at once. Each one waits on a CDN or a profile page, not on us. */
  concurrency?: number;
  readTikTokProfileRemote?: (handle: string) => Promise<CreatorReadResult>;
  nowMs?: number;
} = {}): Promise<AvatarRefreshCounts> {
  const log = createLogger({ context: { job: "refresh-creator-avatars" } });
  const deadline = Date.now() + deadlineMs;
  const staleBefore = new Date(nowMs - AVATAR_STALE_MS);
  const retryBefore = new Date(nowMs - AVATAR_RETRY_MS);
  const counts: AvatarRefreshCounts = { considered: 0, stored: 0, failed: 0, skipped: 0 };

  let creators;
  try {
    creators = await db.creator.findMany({
      where: {
        deletedAt: null,
        /* The holding row for unattributed posts is nobody. Its first post's
           author picture is a stranger's face. */
        NOT: UNATTRIBUTED_CREATOR_WHERE,
        OR: [
          { avatar: null },
          {
            avatar: {
              OR: [{ fetchedAt: null }, { fetchedAt: { lt: staleBefore } }],
              AND: [
                {
                  OR: [
                    { failedAt: null },
                    { failedAt: { lt: retryBefore } },
                    { failure: { startsWith: RATE_LIMITED_FAILURE } },
                  ],
                },
              ],
            },
          },
        ],
      },
      orderBy: { addedAt: "desc" },
      take: limit,
      select: {
        id: true,
        orgId: true,
        platform: true,
        handle: true,
        avatarUrl: true,
        posts: {
          where: { authorProfilePic: { not: null } },
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { authorProfilePic: true },
        },
      },
    });
  } catch (e) {
    if (isMissingTable(e)) {
      log.warn("CreatorAvatar table missing; apply /api/admin/migrate-creator-avatars");
      return counts;
    }
    throw e;
  }

  // As in refreshRosterProfiles: once a platform rate-limits us, stop asking
  // it this run, and do not count that as the creator's failure.
  const limited = new Set<string>();

  const refreshOne = async (creator: (typeof creators)[number]) => {
    counts.considered++;

    const held = [creator.avatarUrl, creator.posts[0]?.authorProfilePic].filter((u): u is string =>
      isFetchableAvatarUrl(u, nowMs)
    );
    let stored = false;
    for (const url of held) {
      if (await storeAvatarFromUrl(creator.id, creator.orgId, url)) {
        stored = true;
        break;
      }
    }

    let failure = held.length ? "stored links did not load" : "no live link held";
    if (!stored && creator.handle && limited.has(creator.platform)) {
      counts.skipped++;
      return;
    }
    if (!stored && creator.handle) {
      let read: CreatorReadResult = await readCreatorProfile(creator.platform, creator.handle, {
        instagramStopAtPercent: TRACKER_SWEEP_STOP_PERCENT,
        orgId: creator.orgId,
      }).catch(
        (e): CreatorReadResult => ({ ok: false, reason: "unreadable", detail: String(e) })
      );
      if (!read.ok && creator.platform === "TIKTOK" && readTikTokProfileRemote) {
        const remote = await readTikTokProfileRemote(creator.handle).catch(() => null);
        if (remote) read = remote;
      }
      if (!read.ok && read.reason === "rate-limited") {
        limited.add(creator.platform);
        counts.skipped++;
        return;
      }
      if (read.ok && read.profile.avatarUrl) {
        stored = await storeAvatarFromUrl(creator.id, creator.orgId, read.profile.avatarUrl);
        if (!stored) failure = "profile picture did not load";
      } else {
        failure = read.ok ? "profile has no picture" : `profile read: ${read.reason}`;
      }
    }

    if (stored) counts.stored++;
    else {
      counts.failed++;
      await recordFailure(creator.id, creator.orgId, failure);
    }
  };

  // Workers take the next creator in order until the list or the clock runs
  // out; whoever is left unclaimed is counted as skipped for the next hour.
  let next = 0;
  const worker = async () => {
    while (next < creators.length && Date.now() <= deadline) {
      await refreshOne(creators[next++]);
    }
  };
  const workers = Math.max(1, Math.min(Math.floor(concurrency) || 1, creators.length));
  await Promise.all(Array.from({ length: workers }, worker));
  counts.skipped += creators.length - next;

  log.info("avatar refresh complete", { ...counts });
  return counts;
}
