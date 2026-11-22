import { db } from "@/lib/db";
import { isMissingSongAlbumTable } from "./songAlbumDdl";

/**
 * Every read and write of a song's linked Spotify album (SongSpotifyAlbum).
 *
 * The tables arrive after the code (lib/songs/songAlbumDdl.ts). While they are
 * missing no song has an album: the cron and the card behave exactly as
 * before, and saving an album link answers "unavailable" so the route can say
 * the link was not saved.
 */

export type SongAlbumLink = { albumId: string; albumName: string | null; albumArtists: string | null };

export async function songAlbumsReady(): Promise<boolean> {
  try {
    await db.songSpotifyAlbum.findFirst({ select: { songId: true } });
    await db.songStreamTrackReading.findFirst({ select: { id: true } });
    return true;
  } catch (e) {
    if (isMissingSongAlbumTable(e)) return false;
    throw e;
  }
}

/** The song's linked album; `ready: false` while the tables do not exist. */
export async function readSongAlbum(
  orgId: string,
  songId: string
): Promise<{ ready: boolean; album: SongAlbumLink | null }> {
  try {
    const row = await db.songSpotifyAlbum.findFirst({
      where: { songId, orgId },
      select: { albumId: true, albumName: true, albumArtists: true },
    });
    return { ready: true, album: row };
  } catch (e) {
    if (isMissingSongAlbumTable(e)) return { ready: false, album: null };
    throw e;
  }
}

/** The linked albums of several songs, for the daily sweep; empty while the tables are missing. */
export async function readSongAlbums(songIds: string[]): Promise<Map<string, SongAlbumLink>> {
  if (!songIds.length) return new Map();
  try {
    const rows = await db.songSpotifyAlbum.findMany({
      where: { songId: { in: songIds } },
      select: { songId: true, albumId: true, albumName: true, albumArtists: true },
    });
    return new Map(rows.map(({ songId, ...album }) => [songId, album]));
  } catch (e) {
    if (isMissingSongAlbumTable(e)) return new Map();
    throw e;
  }
}

export type SongAlbumSave = "changed" | "unchanged" | "unavailable";

/**
 * Sets or clears the song's album. The song itself is checked by the caller
 * (same org, not deleted); the orgId is still part of every statement.
 */
export async function saveSongAlbum(orgId: string, songId: string, albumId: string | null): Promise<SongAlbumSave> {
  try {
    const current = await db.songSpotifyAlbum.findFirst({ where: { songId, orgId }, select: { albumId: true } });
    if ((current?.albumId ?? null) === albumId) return "unchanged";
    if (!albumId) {
      await db.songSpotifyAlbum.deleteMany({ where: { songId, orgId } });
      return "changed";
    }
    if (current) {
      await db.songSpotifyAlbum.updateMany({
        where: { songId, orgId },
        data: { albumId, albumName: null, albumArtists: null },
      });
    } else {
      await db.songSpotifyAlbum.create({ data: { songId, orgId, albumId }, select: { songId: true } });
    }
    return "changed";
  } catch (e) {
    if (isMissingSongAlbumTable(e)) return "unavailable";
    throw e;
  }
}

/** The album's name and artists as the newest reading gave them. */
export async function noteSongAlbumName(orgId: string, songId: string, albumId: string, name: string, artists: string) {
  await db.songSpotifyAlbum.updateMany({ where: { songId, orgId, albumId }, data: { albumName: name, albumArtists: artists } });
}
