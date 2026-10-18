import { db } from "@/lib/db";
import { loadImage, resizeImage } from "@/lib/media/loadImage";
import { createLogger } from "@/lib/observability/logger";
import { isFetchableAvatarUrl as isFetchableImageUrl } from "@/lib/creators/avatarStore";
import { linkKey, pictureKey } from "@/lib/campaigns/pictureLink";

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
 * #keepSoundArtwork), which downloads it once, shrinks it to an AVIF and keeps
 * it in SoundCover. The report, the campaigns list and the trackers page read
 * it back through /api/sounds/[id]/cover and /api/share/[token]/sound-cover and
 * never depend on the CDN link again. The same contract as PostThumbnail
 * (lib/posts/thumbnailStore) and CreatorAvatar.
 */

/** Square covers, shrunk to fit this box: the largest surface asks for 384. */
export const SOUND_COVER_STORE_PX = 384;
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
 *
 * With nothing held, the failed link goes into sourceUrl, which is how the
 * retry wait knows which link it is waiting out: a different link is tried at
 * once. With a copy held, sourceUrl keeps naming the copy.
 */
export async function storeSoundCoverFromUrl(
  sound: { id: string; orgId: string },
  url: string,
  options: { timeoutMs?: number; holding?: boolean } = {}
): Promise<SoundCoverStoreResult> {
  const loaded = await loadImage(url, SOUND_COVER_STORE_PX, SOUND_COVER_STORE_PX, "sounds/coverStore", {
    fit: "inside",
    timeoutMs: options.timeoutMs ?? SOUND_COVER_FETCH_TIMEOUT_MS,
    format: "avif",
  });
  try {
    /* Our own AVIF only (lib/media/loadImage#ImageFormat). loadImage hands back
       the CDN's own bytes when it cannot transcode them, and those are neither
       bounded by the box above nor something every browser decodes. */
    if (loaded.ok && loaded.contentType === "image/avif") {
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
      create: { soundId: sound.id, orgId: sound.orgId, sourceUrl: url, failedAt: new Date(), failure },
      update: { failedAt: new Date(), failure, ...(options.holding ? {} : { sourceUrl: url }) },
    });
    return { stored: false, failure };
  } catch (e) {
    if (isMissingSoundCoverTable(e)) return { stored: false, failure: "table missing" };
    throw e;
  }
}

/** A sound tracked this long with no copy of its cover is reported, not left to show a music note. */
export const SOUND_COVER_MISSING_ALERT_MS = 24 * 60 * 60 * 1000;

/**
 * Sounds tracked for a day or more that still hold no copy of their cover,
 * across every org -- what the daily sound cron reports. A copy, once held,
 * is never erased by a failed reading, so this names exactly the sounds whose
 * cover was never downloaded: on 2026-10-19 one whose picture TikTok served
 * only to US networks, which no automatic retry from sin1 can reach and which
 * /api/admin/upload-sound-cover exists for. An empty list before the table
 * exists, like every other read here.
 */
export async function soundsWithoutCover(nowMs = Date.now()): Promise<string[]> {
  try {
    const rows = await db.tikTokSound.findMany({
      where: {
        createdAt: { lt: new Date(nowMs - SOUND_COVER_MISSING_ALERT_MS) },
        OR: [{ cover: { is: null } }, { cover: { is: { fetchedAt: null } } }],
      },
      select: { id: true },
      orderBy: { id: "asc" },
      take: 50,
    });
    return rows.map((r) => r.id);
  } catch (e) {
    if (isMissingSoundCoverTable(e)) return [];
    throw e;
  }
}

/** Largest picture an admin may hand in; covers are a few hundred KB. */
export const SOUND_COVER_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

export type SoundCoverUploadResult =
  | { stored: true; bytes: number }
  | { stored: false; status: 404 | 413 | 422; failure: string };

/**
 * Keep a picture someone downloaded elsewhere as a sound's cover.
 *
 * For the cover the app cannot fetch from where it runs: TikTok can serve a
 * sound's picture only to some US networks (2026-10-19 -- 200 from a US VPN
 * exit and from two US sandbox regions, 502 through prod's own image proxy in
 * sin1 on every TikTok host tried). Once held under the link it came from,
 * the picture key makes every later reading see the same cover and leave it be.
 *
 * Shrunk to the same AVIF every other copy is, and filed under the sound's own
 * org, read in the same call, so the caller decides nothing about tenancy.
 */
export async function storeSoundCoverFromBytes(
  soundId: string,
  bytes: Buffer,
  sourceUrl: string
): Promise<SoundCoverUploadResult> {
  if (bytes.byteLength > SOUND_COVER_UPLOAD_MAX_BYTES) return { stored: false, status: 413, failure: "too large" };
  const sound = await db.tikTokSound.findUnique({ where: { id: soundId }, select: { orgId: true } });
  if (!sound) return { stored: false, status: 404, failure: "no such sound" };
  let encoded: Buffer;
  try {
    encoded = await resizeImage(bytes, false, SOUND_COVER_STORE_PX, SOUND_COVER_STORE_PX, "inside", "avif");
  } catch {
    return { stored: false, status: 422, failure: "not an image" };
  }
  const now = new Date();
  const data = new Uint8Array(encoded);
  await db.soundCover.upsert({
    where: { soundId },
    create: { soundId, orgId: sound.orgId, data, sourceUrl, fetchedAt: now },
    update: { data, sourceUrl, fetchedAt: now, failedAt: null, failure: null },
  });
  return { stored: true, bytes: data.byteLength };
}

/** Where a link points, without its signature: enough to tell links apart in a log. */
export function describeImageLink(url: string): string {
  try {
    const { hostname, pathname } = new URL(url);
    return `${hostname}/${pathname.split("/")[1] ?? ""}`;
  } catch {
    return "unparsable";
  }
}

/**
 * Called by every reader that has just been handed a sound's cover, with the
 * links it has in order of preference -- the reading's own first, then the
 * row's. Downloads only when there is something new to keep: no copy yet, or a
 * different picture (a new image key -- the signature and host change on every
 * read, the key does not). The same cover seen again costs one primary-key
 * read and no download, so a sound read hourly pays for its artwork once.
 *
 * A failed download is waited out by its address, not its picture: the same
 * cover can be gone from one TikTok host and served by another.
 *
 * Every candidate is tried, not just the first. A sound's stored link can be
 * dead without ever looking stale -- an unsigned link carries no expiry to read
 * -- and one such link (2026-10-18, a 404 from TikTok's CDN) kept a client
 * report on a music note while the reading in hand had another to offer.
 *
 * Returns the link whose picture this call stored, so the caller can point the
 * row at a link known to work; null when nothing new was stored.
 *
 * The org comes from the sound's own row, in the same read, so no caller can
 * file a cover under the wrong tenant.
 *
 * Never throws and never fails a reading: a picture is not worth losing a
 * snapshot over.
 */
export async function captureSoundCover(
  soundId: string,
  candidates: string | null | undefined | ReadonlyArray<string | null | undefined>,
  nowMs = Date.now()
): Promise<string | null> {
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const u of typeof candidates === "string" || candidates == null ? [candidates] : candidates) {
    if (!isFetchableImageUrl(u, nowMs)) continue;
    const key = linkKey(u) ?? u;
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(u);
  }
  if (!urls.length) return null;
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
    if (!sound) return null;
    const row = sound.cover;
    const holding = Boolean(row?.fetchedAt);
    const heldKey = holding ? pictureKey(row?.sourceUrl) : null;
    const lastFailedLink = !holding && row?.failedAt && nowMs - row.failedAt.getTime() < SOUND_COVER_RETRY_MS
      ? linkKey(row.sourceUrl)
      : null;

    const tried: { link: string; failure: string }[] = [];
    for (const url of urls) {
      // Already holding the best picture on offer; nothing after it would replace it.
      if (heldKey !== null && pictureKey(url) === heldKey) break;
      if (lastFailedLink !== null && linkKey(url) === lastFailedLink) {
        tried.push({ link: describeImageLink(url), failure: "failed lately; waiting" });
        continue;
      }
      const result = await storeSoundCoverFromUrl({ id: soundId, orgId: sound.orgId }, url, { holding });
      if (result.stored) {
        log.info("sound cover capture", {
          soundId,
          stored: true,
          bytes: result.bytes,
          link: describeImageLink(url),
          ...(tried.length ? { tried } : {}),
          ms: Date.now() - started,
        });
        return url;
      }
      tried.push({ link: describeImageLink(url), failure: result.failure });
    }
    if (tried.length) log.info("sound cover capture", { soundId, stored: false, tried, ms: Date.now() - started });
    return null;
  } catch (e) {
    if (!isMissingSoundCoverTable(e)) {
      log.warn("sound cover capture failed", { soundId, error: e instanceof Error ? e.message : String(e) });
    }
    return null;
  }
}
