import { db } from "@/lib/db";
import { isMissingSongLinkColumn } from "./songLinkDdl";

/**
 * Every read and write of Song.spotifyTrackId, and the readiness test both
 * song link columns share, in one place, because the columns arrive after the
 * code does (lib/songs/songLinkDdl.ts). Song.instagramSoundId's own reads and
 * writes are in lib/songs/songSounds.ts, on the same test.
 *
 * While they are missing a song simply has no links: the cron matches by title
 * and artist as it always has, the campaign is created without the link, and
 * Settings says the links cannot be saved yet. Nothing here ever turns a
 * missing column into a failed page or a failed campaign.
 */

/**
 * Runs a read that names the link columns; on a database without them, runs
 * the same read without them. `linkReady` says which one answered.
 */
export async function withSongLinkColumns<T>(
  read: (withLink: boolean) => Promise<T>
): Promise<{ value: T; linkReady: boolean }> {
  try {
    return { value: await read(true), linkReady: true };
  } catch (e) {
    if (!isMissingSongLinkColumn(e)) throw e;
    return { value: await read(false), linkReady: false };
  }
}

/**
 * Whether links can be stored at all. Asked before anything is written for
 * one. Names both columns: the DDL adds them together, and a database with only
 * one of them is not one this code writes to.
 */
export async function songLinksReady(orgId: string): Promise<boolean> {
  try {
    await db.song.findFirst({ where: { orgId }, select: { spotifyTrackId: true, instagramSoundId: true } });
    return true;
  } catch (e) {
    if (isMissingSongLinkColumn(e)) return false;
    throw e;
  }
}

/** The song's linked track; `ready: false` while the column does not exist. */
export async function readSongSpotifyLink(
  orgId: string,
  songId: string
): Promise<{ ready: boolean; trackId: string | null }> {
  try {
    const song = await db.song.findFirst({
      where: { id: songId, orgId, deletedAt: null },
      select: { spotifyTrackId: true },
    });
    return { ready: true, trackId: song?.spotifyTrackId ?? null };
  } catch (e) {
    if (isMissingSongLinkColumn(e)) return { ready: false, trackId: null };
    throw e;
  }
}

/**
 * "changed" when the song now carries a different link (set, replaced or
 * cleared), which is what earns a first reading. Written outside any
 * transaction on purpose: a failed statement aborts a Postgres transaction, so
 * a missing column inside the campaign's own create would take the campaign
 * down with it.
 */
export type SpotifyLinkSave = "changed" | "unchanged" | "unavailable" | "no-song";

export async function saveSongSpotifyLink(
  orgId: string,
  songId: string,
  trackId: string | null
): Promise<SpotifyLinkSave> {
  try {
    const song = await db.song.findFirst({
      where: { id: songId, orgId, deletedAt: null },
      select: { spotifyTrackId: true },
    });
    if (!song) return "no-song";
    if ((song.spotifyTrackId ?? null) === trackId) return "unchanged";
    /* updateMany, so the orgId is part of the write and nothing is returned:
       the statement names this one column and no other. It also moves
       updatedAt, which the cron reads: a track matched before the link was
       cleared is not trusted afterwards, and the song is searched again. */
    await db.song.updateMany({ where: { id: songId, orgId }, data: { spotifyTrackId: trackId } });
    return "changed";
  } catch (e) {
    if (isMissingSongLinkColumn(e)) return "unavailable";
    throw e;
  }
}

export const SPOTIFY_LINK_UNAVAILABLE = "Spotify links can't be saved yet. Try again later.";
