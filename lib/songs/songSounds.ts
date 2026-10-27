import { db as moduleDb } from "@/lib/db";
import type { PrismaClient } from "@/lib/generated/prisma";
import { isMissingSongLinkColumn } from "./songLinkDdl";

/**
 * A song's two sounds: the TikTok one in Song.soundId and the Instagram one in
 * Song.instagramSoundId.
 *
 * Read by the sound's own platform, not by the column it sits in. Before
 * instagramSoundId a song had one sound, of either platform, and production
 * holds songs whose soundId is an Instagram audio; those are that song's
 * Instagram sound and read as such, with nothing migrated.
 *
 * instagramSoundId arrives after this code does (lib/songs/songLinkDdl.ts).
 * Until it does, `ready` is false, the song's Instagram sound is whatever
 * soundId holds, and nothing is written to the column.
 */

export type SongSoundPlatform = "TIKTOK" | "INSTAGRAM";

type Db = Pick<PrismaClient, "song">;

type WithPlatform = { platform: string };

/** The TikTok and the Instagram sound among a song's two slots. */
export function sortSongSounds<T extends WithPlatform>(
  soundSlot: T | null | undefined,
  instagramSlot: T | null | undefined
): { tiktok: T | null; instagram: T | null } {
  const slots = [soundSlot ?? null, instagramSlot ?? null];
  return {
    tiktok: slots.find((s) => s?.platform === "TIKTOK") ?? null,
    /* The dedicated slot first: a song that took a TikTok sound after an
       Instagram one moved the Instagram one across, so two Instagram sounds
       only coexist if something wrote around this module. */
    instagram: [instagramSlot ?? null, soundSlot ?? null].find((s) => s?.platform === "INSTAGRAM") ?? null,
  };
}

export const SONG_SOUND_SELECT = {
  id: true,
  platform: true,
  tiktokSoundId: true,
  title: true,
  artist: true,
  coverImageUrl: true,
} as const;

export type SongSoundRow = {
  id: string;
  platform: string;
  tiktokSoundId: string;
  title: string;
  artist: string;
  coverImageUrl: string | null;
};

export type SongSounds = {
  /** False while Song.instagramSoundId does not exist: nothing can be stored in it yet. */
  ready: boolean;
  tiktok: SongSoundRow | null;
  instagram: SongSoundRow | null;
};

const NONE: Omit<SongSounds, "ready"> = { tiktok: null, instagram: null };

/** A song's TikTok and Instagram sounds. Org-scoped; a song that is not the org's reads as none. */
export async function readSongSounds(orgId: string, songId: string | null | undefined, db: Db = moduleDb): Promise<SongSounds> {
  if (!songId) return { ready: true, ...NONE };
  try {
    const song = await db.song.findFirst({
      where: { id: songId, orgId },
      select: { sound: { select: SONG_SOUND_SELECT }, instagramSound: { select: SONG_SOUND_SELECT } },
    });
    return { ready: true, ...sortSongSounds(song?.sound, song?.instagramSound) };
  } catch (e) {
    if (!isMissingSongLinkColumn(e)) throw e;
    const song = await db.song.findFirst({
      where: { id: songId, orgId },
      select: { sound: { select: SONG_SOUND_SELECT } },
    });
    return { ready: false, ...sortSongSounds(song?.sound, null) };
  }
}

/** The two sound row ids alone, for callers that only need to find covers and readings. */
export async function readSongSoundIds(
  orgId: string,
  songId: string | null | undefined,
  db: Db = moduleDb
): Promise<{ tiktok: string | null; instagram: string | null }> {
  const sounds = await readSongSounds(orgId, songId, db);
  return { tiktok: sounds.tiktok?.id ?? null, instagram: sounds.instagram?.id ?? null };
}

/**
 * Puts a sound in its platform's slot on the song, replacing whatever that
 * slot held. Only called once the columns exist (songLinksReady).
 *
 * A TikTok sound taking soundId from an older song's Instagram sound moves
 * that Instagram sound into instagramSoundId first, when the slot is free, so
 * adding the TikTok sound never silently drops the Instagram one.
 */
export async function setSongSound(
  db: Db,
  orgId: string,
  songId: string,
  sound: { id: string; platform: SongSoundPlatform }
): Promise<"changed" | "unchanged" | "no-song"> {
  const song = await db.song.findFirst({
    where: { id: songId, orgId, deletedAt: null },
    select: { soundId: true, instagramSoundId: true, sound: { select: { platform: true } } },
  });
  if (!song) return "no-song";

  if (sound.platform === "INSTAGRAM") {
    if (song.instagramSoundId === sound.id) return "unchanged";
    /* An older song with this very sound in soundId already has it; writing it
       a second time into the Instagram slot would show it twice. */
    if (song.soundId === sound.id) return "unchanged";
    const legacyInstagram = song.sound?.platform === "INSTAGRAM";
    await db.song.updateMany({
      where: { id: songId, orgId },
      /* Replacing an older song's Instagram sound means emptying soundId, where
         that one lives; the new one goes in its own slot. */
      data: { instagramSoundId: sound.id, ...(legacyInstagram ? { soundId: null } : {}) },
    });
    return "changed";
  }

  if (song.soundId === sound.id) return "unchanged";
  const moveInstagram = song.sound?.platform === "INSTAGRAM" && !song.instagramSoundId;
  await db.song.updateMany({
    where: { id: songId, orgId },
    data: { soundId: sound.id, ...(moveInstagram ? { instagramSoundId: song.soundId } : {}) },
  });
  return "changed";
}

/**
 * Empties the slot holding the song's sound of that platform -- either slot,
 * for an older song whose Instagram sound sits in soundId. Only called once
 * the columns exist (songLinksReady). False when the song had no such sound.
 */
export async function clearSongSound(db: Db, orgId: string, songId: string, platform: SongSoundPlatform): Promise<boolean> {
  const song = await db.song.findFirst({
    where: { id: songId, orgId, deletedAt: null },
    select: {
      sound: { select: { id: true, platform: true } },
      instagramSound: { select: { id: true, platform: true } },
    },
  });
  if (!song) return false;
  const sorted = sortSongSounds(song.sound, song.instagramSound);
  const target = platform === "TIKTOK" ? sorted.tiktok : sorted.instagram;
  if (!target) return false;
  await db.song.updateMany({
    where: { id: songId, orgId },
    data: {
      ...(song.sound?.id === target.id ? { soundId: null } : {}),
      ...(song.instagramSound?.id === target.id ? { instagramSoundId: null } : {}),
    },
  });
  return true;
}
