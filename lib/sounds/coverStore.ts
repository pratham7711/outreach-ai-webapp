import { db } from "@/lib/db";
import { loadImage } from "@/lib/media/loadImage";
import { createLogger } from "@/lib/observability/logger";
import { avatarImageKey as imageKey, isFetchableAvatarUrl as isFetchableImageUrl } from "@/lib/creators/avatarStore";

/**
 * Sound cover art, kept as bytes.
 *
 * TikTok hands out a sound's cover on a signed CDN path (`x-expires=`) that
 * answers 403 once the signature passes, and Instagram's audio covers carry
 * Meta's hex `oe=` the same way. TikTokSound.coverImageUrl was renewed only by
 * a reading that went on to write a snapshot and came back with a cover; a
 * sound that stopped getting those -- a read that fails, a rung that returns
 * no artwork, a rounded figure that adds nothing -- kept a link that died, and
 * the client report showed a music note where the artwork had been.
 *
 * So every accepted reading hands its cover here (lib/sounds/snapshot
 * #keepSoundArtwork), which downloads it once, shrinks it to a WebP and keeps
 * it in SoundCover. The report, the campaigns list and the trackers page read
 * it back through /api/sounds/[id]/cover and /api/share/[token]/sound-cover and
 * never depend on the CDN link again. The same contract as PostThumbnail
 * (lib/posts/thumbnailStore) and CreatorAvatar.
 */

/** Square covers, shrunk to fit this box. The largest surface asks for 384. */
export const SOUND_COVER_STORE_PX = 512;
/** Runs inside a sweep over every due sound, so a stuck CDN must not hold it. */
export const SOUND_COVER_FETCH_TIMEOUT_MS = 5_000;
/** A cover that would not download is asked for again after this, not hourly. */
export const SOUND_COVER_RETRY_MS = 6 * 60 * 60 * 1000;

/** Prisma's "table does not exist" -- the DDL has not been applied yet. */
export function isMissingSoundCoverTable(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const message = e instanceof Error ? e.message : String(e);
  return code === "P2021" || /SoundCover.*does not exist|relation "SoundCover"/i.test(message);
}

export type StoredSoundCover = { data: Uint8Array; fetchedAt: Date | null };

/** The stored cover for one sound in one org, or null -- including when the table is not there yet. */
export async function readStoredSoundCover(soundId: string, orgId: string): Promise<StoredSoundCover | null> {
  try {
    const row = await db.soundCover.findFirst({
      where: { soundId, orgId, data: { not: null } },
      select: { data: true, fetchedAt: true },
    });
    return row?.data ? { data: row.data, fetchedAt: row.fetchedAt } : null;
  } catch (e) {
    if (isMissingSoundCoverTable(e)) return null;
    throw e;
  }
}

/**
 * When each sound's stored cover was taken, for the ones that have one. A page
 * puts it in the cover's URL, so a copy taken after the browser cached a miss
 * is fetched fresh.
 *
 * Never throws: artwork is decoration, and on any error the page falls back to
 * the stored links, which is exactly how it behaved before this store.
 */
export async function storedSoundCoverVersions(soundIds: string[], orgId: string): Promise<Map<string, number>> {
  const ids = [...new Set(soundIds.filter(Boolean))];
  if (!ids.length) return new Map();
  try {
    const rows = await db.soundCover.findMany({
      where: { orgId, soundId: { in: ids }, data: { not: null } },
      select: { soundId: true, fetchedAt: true },
    });
    return new Map(rows.map((r) => [r.soundId, r.fetchedAt?.getTime() ?? 0]));
  } catch (e) {
    if (!isMissingSoundCoverTable(e)) {
      createLogger({ context: { module: "sounds/coverStore" } }).warn("sound cover versions unavailable", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
    return new Map();
  }
}

export type SoundCoverStoreResult = { stored: true; bytes: number } | { stored: false; failure: string };

/**
 * Download one URL and keep it. A failure never erases a cover already held --
 * a sound whose new link is dead keeps showing the last good picture -- but it
 * is recorded, so the next reading does not ask again for SOUND_COVER_RETRY_MS.
 */
export async function storeSoundCoverFromUrl(
  sound: { id: string; orgId: string },
  url: string,
  options: { timeoutMs?: number } = {}
): Promise<SoundCoverStoreResult> {
  const loaded = await loadImage(url, SOUND_COVER_STORE_PX, SOUND_COVER_STORE_PX, "sounds/coverStore", {
    fit: "inside",
    timeoutMs: options.timeoutMs ?? SOUND_COVER_FETCH_TIMEOUT_MS,
  });
  try {
    /* WebP only. loadImage hands back the CDN's own bytes when it cannot
       transcode them, and those are neither bounded by the box above nor
       something every browser decodes. */
    if (loaded.ok && loaded.contentType === "image/webp") {
      const now = new Date();
      const data = new Uint8Array(loaded.body);
      await db.soundCover.upsert({
        where: { soundId: sound.id },
        create: { soundId: sound.id, orgId: sound.orgId, data, sourceUrl: url, fetchedAt: now },
        update: { data, sourceUrl: url, fetchedAt: now, failedAt: null, failure: null },
      });
      return { stored: true, bytes: data.byteLength };
    }
    const failure = loaded.ok ? `not transcoded (${loaded.contentType})` : loaded.message;
    await db.soundCover.upsert({
      where: { soundId: sound.id },
      create: { soundId: sound.id, orgId: sound.orgId, failedAt: new Date(), failure },
      update: { failedAt: new Date(), failure },
    });
    return { stored: false, failure };
  } catch (e) {
    if (isMissingSoundCoverTable(e)) return { stored: false, failure: "table missing" };
    throw e;
  }
}

/**
 * Called by every reader that has just been handed a sound's cover. Downloads
 * only when there is something new to keep: no copy yet, or a different
 * picture (a new image key -- the signature and host change on every read, the
 * key does not). The same cover seen again costs one primary-key read and no
 * download, so a sound read hourly pays for its artwork once.
 *
 * The org comes from the sound's own row, in the same read, so no caller can
 * file a cover under the wrong tenant.
 *
 * Never throws and never fails a reading: a picture is not worth losing a
 * snapshot over.
 */
export async function captureSoundCover(
  soundId: string,
  url: string | null | undefined,
  nowMs = Date.now()
): Promise<boolean> {
  if (!isFetchableImageUrl(url, nowMs)) return false;
  const started = Date.now();
  const log = createLogger({ context: { module: "sounds/coverStore" } });
  try {
    /* fetchedAt, not data, says a copy is held: only a successful store sets
       it, and selecting the bytes to test them would pull the picture out of
       the database on every reading of every sound, to throw away. */
    const sound = await db.tikTokSound.findUnique({
      where: { id: soundId },
      select: {
        orgId: true,
        cover: { select: { fetchedAt: true, sourceUrl: true, failedAt: true } },
      },
    });
    if (!sound) return false;
    const row = sound.cover;
    const key = imageKey(url);
    if (row?.fetchedAt && key !== null && imageKey(row.sourceUrl) === key) return false;
    if (row?.failedAt && nowMs - row.failedAt.getTime() < SOUND_COVER_RETRY_MS) return false;

    const result = await storeSoundCoverFromUrl({ id: soundId, orgId: sound.orgId }, url);
    log.info("sound cover capture", {
      soundId,
      stored: result.stored,
      ...(result.stored ? { bytes: result.bytes } : { failure: result.failure }),
      ms: Date.now() - started,
    });
    return result.stored;
  } catch (e) {
    if (!isMissingSoundCoverTable(e)) {
      log.warn("sound cover capture failed", { soundId, error: e instanceof Error ? e.message : String(e) });
    }
    return false;
  }
}
