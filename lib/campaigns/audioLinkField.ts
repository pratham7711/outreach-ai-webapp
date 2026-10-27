import { SPOTIFY_LINK_ERRORS, SPOTIFY_SHORT_HOSTS } from "@/lib/songs/spotifyLink";

/**
 * Which of a campaign's three audio fields a pasted link belongs in, and what
 * to say when a link is not taken.
 *
 * The New Campaign form and the campaign's audio settings used to refuse a
 * link pasted into the wrong field ("That's an Instagram audio. Put it in the
 * Instagram audio field.") and refuse an untrackable one with a paragraph,
 * holding Create back either way. A person has a link, not a field: the link
 * now goes where it belongs, and one that can never give a number to follow is
 * left out with a line saying why, instead of blocking the form.
 *
 * The field is decided by the link's site, not by whether the link is usable.
 * A TikTok video goes to the TikTok field, where it is turned away as a post
 * with the way to its sound's page; it is not "not an Instagram audio" in
 * whichever field it happened to be pasted into.
 */

export type AudioField = "TIKTOK" | "INSTAGRAM" | "SPOTIFY";

export const AUDIO_FIELD_NAME: Record<AudioField, string> = {
  TIKTOK: "TikTok sound",
  INSTAGRAM: "Instagram audio",
  SPOTIFY: "Spotify link",
};

/** The field a value belongs in, or null when it is none of the three sites. */
export function audioFieldFor(value: string): AudioField | null {
  const raw = value.trim();
  if (!raw) return null;
  if (/^spotify:/i.test(raw)) return "SPOTIFY";
  // A bare TikTok sound id, which the sound field has always taken.
  if (/^\d{18,20}$/.test(raw)) return "TIKTOK";

  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase();
  } catch {
    return null;
  }
  const on = (domain: string) => host === domain || host.endsWith(`.${domain}`);
  if (on("tiktok.com")) return "TIKTOK";
  if (on("instagram.com")) return "INSTAGRAM";
  if (on("spotify.com") || SPOTIFY_SHORT_HOSTS.has(host)) return "SPOTIFY";
  return null;
}

/**
 * Whether pasted text is a link at all: one of the three sites, or any other
 * web address (which is then left out by name). Anything else is ordinary
 * typing and is pasted as usual.
 */
export function isLinkLike(value: string): boolean {
  const raw = value.trim();
  return audioFieldFor(raw) !== null || /^(https?:\/\/|www\.)\S+$/i.test(raw);
}

/**
 * Why a link was left out, in a line, keyed by the reason codes the parsers
 * and the check routes already return. Shorter than the refusals they replace:
 * the person needs what the link was and what to paste instead, not how
 * Instagram's pages are built.
 */
const NOT_ADDED: Record<string, string> = {
  video_url: "That's a link to a post, not its sound. Tap the sound's name on the post and copy the link of the page it opens.",
  unrecognised: "We couldn't find a sound in that link.",
  not_tiktok: "That isn't a TikTok, Instagram or Spotify link.",
  not_instagram_audio: "That isn't an Instagram audio link.",
  instagram_audio_no_count:
    "That's original audio. Instagram doesn't show how many reels use original audio, so there's nothing to track. Songs from Instagram's music library show it.",
  instagram_audio_not_found: "Instagram has no audio at that link.",
  not_found: "Spotify has no track at that link.",
  ...SPOTIFY_LINK_ERRORS,
};

export function notAddedReason(reason: string | null | undefined, fallback: string): string {
  return (reason ? NOT_ADDED[reason] : undefined) ?? fallback;
}

/** What sits under a field after a paste: where the link came from, or why it was left out. */
export type AudioFieldNoticeValue = { tone: "moved" | "dropped"; text: string };

export function movedNotice(from: AudioField, replaced: boolean): AudioFieldNoticeValue {
  return {
    tone: "moved",
    text: replaced
      ? `Moved here from ${AUDIO_FIELD_NAME[from]}, in place of the link that was here.`
      : `Moved here from ${AUDIO_FIELD_NAME[from]}.`,
  };
}

/**
 * `kept`: the field still holds the link it had before. Said, because the line
 * sits right above that link's card and would otherwise read as being about it.
 */
export function droppedNotice(reason: string | null | undefined, fallback: string, kept = false): AudioFieldNoticeValue {
  const text = notAddedReason(reason, fallback);
  return { tone: "dropped", text: kept ? `${text} The link already in this field stays.` : text };
}

/**
 * Refusals that say something about the link, as opposed to the moment: these
 * leave the link out. Anything else -- a platform that did not answer, a short
 * link that could not be followed just now -- keeps the link and says so, and
 * the save asks again.
 */
export function isLastingRefusal(reason: string | null | undefined): boolean {
  return reason != null && reason !== "short_link_unresolvable" && reason in NOT_ADDED;
}
