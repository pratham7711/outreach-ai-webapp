/**
 * Turning a pasted audio link into something a campaign can point at.
 *
 * The chain is Campaign.songId -> Song.soundId -> TikTokSound, and it is that
 * shape on purpose: the usage curve belongs to the audio, so three campaigns
 * pushing the same release read one tracker and none of them owns it. Creating
 * a campaign with an audio link therefore has to find-or-create both rows, and
 * find rather than create is the important half -- a second campaign on the
 * same sound must join the existing tracker, not fork a private copy of it.
 *
 * A release is promoted on TikTok and on Instagram at once, so the song has a
 * second slot, Song.instagramSoundId, for its Instagram audio
 * (lib/songs/songSounds.ts); its Spotify track is a third link beside them.
 */

import type { PrismaClient } from "@/lib/generated/prisma";
import { SOUND_URL_ERRORS, parseSoundUrl } from "@/lib/trackers/soundUrl";
import { expandShortLink } from "@/lib/trackers/expandShortLink";
import { readOneInstagramAudio } from "@/lib/platforms/instagramAudioUsage";
import type { InstagramAudioReading } from "@/lib/platforms/instagramAudioPage";

export type AudioLinkResult =
  | { ok: true; songId: string }
  | { ok: false; reason: string; message: string };

/** What a usable audio link resolves to, before anything is written. */
export type ResolvedAudio = {
  platform: "TIKTOK" | "INSTAGRAM";
  tiktokSoundId: string;
  provisionalTitle?: string | null;
};

export type AudioLinkParse =
  | { ok: true; audio: ResolvedAudio }
  | { ok: false; reason: string; message: string };

/* Deliberately narrow, so a transaction client satisfies it: the two writes
   below belong inside the caller's transaction (see identifyAudioLink). */
type Db = Pick<PrismaClient, "tikTokSound" | "song">;

/**
 * The half of this that touches the network, kept separate from the half that
 * writes.
 *
 * A short TikTok link is resolved by following it, which is an HTTP round trip
 * against a third party. That cannot happen inside a database transaction --
 * it would hold the transaction open for as long as TikTok feels like taking.
 * So the caller parses first, out here, and opens the transaction afterwards.
 */
export async function identifyAudioLink(url: string): Promise<AudioLinkParse> {
  let parsed = parseSoundUrl(url);

  if (parsed.kind === "short-link") {
    const expanded = await expandShortLink(parsed.url);
    parsed = expanded
      ? parseSoundUrl(expanded)
      : { kind: "invalid", reason: "unrecognised" };
    if (!expanded) {
      return {
        ok: false,
        reason: "short_link_unresolvable",
        message: SOUND_URL_ERRORS.short_link_unresolvable,
      };
    }
  }

  if (parsed.kind !== "sound") {
    const reason =
      parsed.kind === "video" ? "video_url" : parsed.kind === "invalid" ? parsed.reason : "unrecognised";
    return { ok: false, reason, message: SOUND_URL_ERRORS[reason] ?? SOUND_URL_ERRORS.unrecognised };
  }

  const { platform, tiktokSoundId, provisionalTitle } = parsed;
  return { ok: true, audio: { platform, tiktokSoundId, provisionalTitle } };
}

/**
 * Whether Instagram publishes a use count for this audio, asked before it is
 * attached -- the same front-door check the Trackers page makes. Instagram
 * answers 200 for an id that is no audio at all, and original audio publishes
 * no count, so both would be a card that never fills in. Not reaching
 * Instagram is not a refusal: the link is kept and the daily read tries again.
 */
export type InstagramAudioCheck =
  | { ok: true; reading: InstagramAudioReading | null }
  | { ok: false; reason: "instagram_audio_not_found" | "instagram_audio_no_count"; message: string };

export async function checkInstagramAudio(audioId: string): Promise<InstagramAudioCheck> {
  const probe = await readOneInstagramAudio(audioId, { deadlineAt: Date.now() + 15_000 }).catch(() => null);
  if (probe?.ok) return { ok: true, reading: probe.reading };
  if (probe?.reason === "not-found" || probe?.reason === "no-count") {
    const reason = probe.reason === "not-found" ? "instagram_audio_not_found" : "instagram_audio_no_count";
    return { ok: false, reason, message: SOUND_URL_ERRORS[reason] };
  }
  return { ok: true, reading: null };
}

/**
 * Find-or-create the tracker row for a sound. Scoped by platform as well as
 * id: the same numeric id can exist on both, and merging them would point one
 * platform's tracker at the other's curve.
 */
export async function ensureSound(
  db: Pick<PrismaClient, "tikTokSound">,
  orgId: string,
  audio: ResolvedAudio,
  fallbackTitle: string
): Promise<{ id: string; platform: "TIKTOK" | "INSTAGRAM" }> {
  const { platform, tiktokSoundId, provisionalTitle } = audio;
  const sound =
    (await db.tikTokSound.findFirst({
      where: { orgId, platform, tiktokSoundId },
      select: { id: true },
    })) ??
    (await db.tikTokSound.create({
      // Title is marked provisional wherever it is shown; the first reading
      // replaces it with whatever the platform actually calls the sound.
      data: {
        orgId,
        platform,
        tiktokSoundId,
        title: provisionalTitle ?? fallbackTitle,
        artist: "",
      },
      select: { id: true },
    }));
  return { id: sound.id, platform };
}

/**
 * The writing half: find-or-create the TikTokSound and the Song.
 *
 * Takes a `Db` rather than reaching for the module client so the caller can
 * hand it a transaction client. It used to run on the global client while the
 * campaign that needed it was created separately afterwards -- so a campaign
 * insert that failed (a foreign key, a constraint, a dropped connection) left
 * a TikTokSound and a Song behind with nothing pointing at them, and a tracker
 * row is a standing instruction to fetch a page on a schedule.
 *
 * `linksReady` is whether Song.instagramSoundId exists (songLinksReady). With
 * it, an Instagram audio is the song's Instagram sound, in its own slot, so
 * the same song can carry a TikTok sound beside it; without it, an Instagram
 * audio goes in soundId as it always did.
 */
export async function ensureSongForAudio(
  db: Db,
  orgId: string,
  audio: ResolvedAudio,
  /** Used when the link carries no title of its own -- an Instagram audio URL
   *  never does, and a TikTok one only sometimes. */
  fallbackTitle: string,
  opts: { linksReady?: boolean } = {}
): Promise<string> {
  const sound = await ensureSound(db, orgId, audio, fallbackTitle);
  const instagramSlot = audio.platform === "INSTAGRAM" && opts.linksReady === true;

  /* Reuse the release already pointing at this sound rather than making a
     second one, so two campaigns on the same audio share a song row and its
     reporting rolls up instead of splitting in half. An Instagram audio may sit
     in either slot: its own, or soundId on a song from before the slot. */
  const song =
    (await db.song.findFirst({
      where: instagramSlot
        ? { orgId, deletedAt: null, OR: [{ instagramSoundId: sound.id }, { soundId: sound.id }] }
        : { orgId, soundId: sound.id, deletedAt: null },
      select: { id: true },
    })) ??
    (await db.song.create({
      data: {
        orgId,
        ...(instagramSlot ? { instagramSoundId: sound.id } : { soundId: sound.id }),
        title: audio.provisionalTitle ?? fallbackTitle,
        artist: "",
      },
      select: { id: true },
    }));

  return song.id;
}

/**
 * A song for a campaign that names its Spotify track but no TikTok or
 * Instagram sound. Nothing to find-or-create it against -- the link itself is
 * stored on the song afterwards, outside the transaction (lib/songs/
 * songLinks) -- so it is a new row titled like ensureSongForAudio's
 * fallback; the card shows the track's own name once it is read.
 */
export async function createSongForSpotifyLink(db: Pick<PrismaClient, "song">, orgId: string, title: string): Promise<string> {
  const song = await db.song.create({ data: { orgId, title, artist: "" }, select: { id: true } });
  return song.id;
}

/** The two halves together, for callers with nothing to keep them atomic. */
export async function resolveAudioLink(
  db: Db,
  orgId: string,
  url: string,
  fallbackTitle: string
): Promise<AudioLinkResult> {
  const parsed = await identifyAudioLink(url);
  if (!parsed.ok) return parsed;
  return { ok: true, songId: await ensureSongForAudio(db, orgId, parsed.audio, fallbackTitle) };
}
