import type { PrismaClient } from "@/lib/generated/prisma";
import { isMissingSongSoundLinkTable } from "./songSoundLinkDdl";
import type { SongSoundRow } from "./songSounds";

/* songSounds' select, repeated rather than imported: songSounds reads this
   module, and a value import back would make the two a cycle. */
const SOUND_SELECT = {
  id: true,
  platform: true,
  tiktokSoundId: true,
  title: true,
  artist: true,
  coverImageUrl: true,
} as const;

/**
 * A song's sounds on platforms without a column of their own on Song -- today
 * only YouTube Shorts audio -- held in SongSoundLink.
 *
 * The table arrives after the code (lib/songs/songSoundLinkDdl.ts). Until it
 * does, every read here answers "no link" and `songSoundLinksReady` is false,
 * so a caller can refuse to create a tracker it has nowhere to attach.
 */

export type LinkedSoundPlatform = "YOUTUBE";

type LinkDb = Pick<PrismaClient, "songSoundLink">;
type MaybeLinkDb = Partial<LinkDb> | undefined;

/* The app client is imported on first use, not at load: audioLink and songSounds
   import this module, and their unit tests run without a database. A caller that
   passes a client is answered from that client alone. */
async function delegate(db: MaybeLinkDb): Promise<LinkDb["songSoundLink"] | null> {
  const client = db ?? ((await import("@/lib/db")).db as Partial<LinkDb>);
  return client.songSoundLink ?? null;
}

export async function songSoundLinksReady(db?: MaybeLinkDb): Promise<boolean> {
  const links = await delegate(db);
  if (!links) return false;
  try {
    await links.findFirst({ select: { id: true } });
    return true;
  } catch (e) {
    if (isMissingSongSoundLinkTable(e)) return false;
    throw e;
  }
}

/** The song's sound on `platform`, org-scoped. Null when there is none or the table is missing. */
export async function readSongLinkedSound(
  orgId: string,
  songId: string | null | undefined,
  platform: LinkedSoundPlatform,
  db?: MaybeLinkDb,
): Promise<SongSoundRow | null> {
  if (!songId) return null;
  const links = await delegate(db);
  if (!links) return null;
  try {
    const link = await links.findFirst({
      where: { orgId, songId, platform },
      select: { sound: { select: SOUND_SELECT } },
    });
    return link?.sound ?? null;
  } catch (e) {
    if (isMissingSongSoundLinkTable(e)) return null;
    throw e;
  }
}

/** Points the song's `platform` slot at `soundId`, replacing what it held. */
export async function setSongLinkedSound(
  db: LinkDb,
  orgId: string,
  songId: string,
  platform: LinkedSoundPlatform,
  soundId: string,
): Promise<"changed" | "unchanged"> {
  const existing = await db.songSoundLink.findFirst({
    where: { orgId, songId, platform },
    select: { id: true, soundId: true },
  });
  if (existing?.soundId === soundId) return "unchanged";
  if (existing) {
    await db.songSoundLink.update({ where: { id: existing.id }, data: { soundId } });
  } else {
    await db.songSoundLink.create({ data: { orgId, songId, platform, soundId } });
  }
  return "changed";
}

export async function clearSongLinkedSound(
  db: LinkDb,
  orgId: string,
  songId: string,
  platform: LinkedSoundPlatform,
): Promise<boolean> {
  const { count } = await db.songSoundLink.deleteMany({ where: { orgId, songId, platform } });
  return count > 0;
}

/** A live song already promoted with this sound, so a second campaign joins it instead of forking one. */
export async function findSongForLinkedSound(
  db: Pick<PrismaClient, "songSoundLink">,
  orgId: string,
  soundId: string,
): Promise<string | null> {
  const link = await db.songSoundLink.findFirst({
    where: { orgId, soundId, song: { deletedAt: null } },
    select: { songId: true },
    orderBy: { createdAt: "asc" },
  });
  return link?.songId ?? null;
}
