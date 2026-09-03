/**
 * Turning a pasted audio link into something a campaign can point at.
 *
 * The chain is Campaign.songId -> Song.soundId -> TikTokSound, and it is that
 * shape on purpose: the usage curve belongs to the audio, so three campaigns
 * pushing the same release read one tracker and none of them owns it. Creating
 * a campaign with an audio link therefore has to find-or-create both rows, and
 * find rather than create is the important half -- a second campaign on the
 * same sound must join the existing tracker, not fork a private copy of it.
 */

import type { PrismaClient } from "@/lib/generated/prisma";
import { SOUND_URL_ERRORS, parseSoundUrl } from "@/lib/trackers/soundUrl";
import { expandShortLink } from "@/lib/trackers/expandShortLink";

export type AudioLinkResult =
  | { ok: true; songId: string }
  | { ok: false; reason: string; message: string };

type Db = Pick<PrismaClient, "tikTokSound" | "song">;

export async function resolveAudioLink(
  db: Db,
  orgId: string,
  url: string,
  /** Used when the link carries no title of its own -- an Instagram audio URL
   *  never does, and a TikTok one only sometimes. */
  fallbackTitle: string
): Promise<AudioLinkResult> {
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

  /* Scoped by platform as well as id: the same numeric id can exist on both,
     and merging them would point one platform's tracker at the other's curve. */
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

  /* Reuse the release already pointing at this sound rather than making a
     second one, so two campaigns on the same audio share a song row and its
     reporting rolls up instead of splitting in half. */
  const song =
    (await db.song.findFirst({
      where: { orgId, soundId: sound.id, deletedAt: null },
      select: { id: true },
    })) ??
    (await db.song.create({
      data: {
        orgId,
        soundId: sound.id,
        title: provisionalTitle ?? fallbackTitle,
        artist: "",
      },
      select: { id: true },
    }));

  return { ok: true, songId: song.id };
}
