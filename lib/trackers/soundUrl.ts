/**
 * Turning a pasted TikTok link into a sound id.
 *
 * Adding a tracker used to mean hand-typing an id, a title and an artist, which
 * is how three sounds with invented ids (7300001-3) ended up in production
 * summing into every headline tile. A link is the thing a person actually has,
 * and it carries the id already.
 *
 * Only the id and a provisional title come from the URL. Artist, cover art and
 * the use count arrive with the first reading: TikTok's music endpoint answers
 * empty without headers its own client script generates, so nothing server-side
 * can fetch them however much we would like to.
 */

/** Same bound as the POST schema: a snowflake, with room for a digit of drift. */
const ID_RE = /(\d{18,20})/;

const TIKTOK_HOSTS = new Set([
  "tiktok.com",
  "www.tiktok.com",
  "m.tiktok.com",
  "vm.tiktok.com",
  "vt.tiktok.com",
]);

/** The share-sheet hosts, whose path is an opaque token carrying no id. */
const SHORT_HOSTS = new Set(["vm.tiktok.com", "vt.tiktok.com"]);

export type ParsedSoundUrl =
  | { kind: "sound"; tiktokSoundId: string; provisionalTitle: string | null }
  | { kind: "short-link"; url: string }
  | { kind: "video"; reason: "video_url" }
  | { kind: "invalid"; reason: "not_tiktok" | "unrecognised" };

function normaliseHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "www.");
}

/**
 * "wherever-i-go" -> "Wherever I Go".
 *
 * Lossy on purpose and marked provisional wherever it is shown: the slug is a
 * URL-safe rendering of the title, not the title. The first reading overwrites
 * it with what TikTok actually calls the sound.
 */
export function deslugTitle(slug: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(slug);
  } catch {
    decoded = slug; // a stray % is not worth losing the whole title over
  }

  const withoutId = decoded
    .replace(/-+\d{15,21}$/, "") // "wherever-i-go-7546..." -> "wherever-i-go"
    .replace(/^\d{15,21}$/, ""); // a slug that is nothing but the id

  const words = withoutId.split("-").filter(Boolean);
  if (words.length === 0) return null;

  // Every word is capitalised, with no small-word exception. Slugs are
  // lowercased titles, so the single-letter case is "i" in "wherever-i-go",
  // which must come back as "I" -- an exception for short words gets that one
  // wrong to spare "up in the air", and the wrong one is the common one.
  const title = words
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ")
    .trim();
  return title.length > 0 ? title : null;
}

export function parseSoundUrl(input: string): ParsedSoundUrl {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return { kind: "invalid", reason: "unrecognised" };

  // A bare id is still accepted — it is what the old form took, and ops paste it.
  if (/^\d{18,20}$/.test(trimmed)) {
    return { kind: "sound", tiktokSoundId: trimmed, provisionalTitle: null };
  }

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { kind: "invalid", reason: "unrecognised" };
  }

  const host = normaliseHost(url.hostname);
  if (!TIKTOK_HOSTS.has(host)) return { kind: "invalid", reason: "not_tiktok" };

  // Query and fragment are noise here: share links carry _t, _r, is_from_webapp
  // and friends, and two links to the same sound must resolve identically.
  const path = url.pathname.replace(/\/+$/, "");

  // A video link is the common mistake — the id in it is a *video* id, and
  // tracking it would follow a sound that does not exist.
  if (/^\/@[^/]+\/(video|photo)\/\d+/.test(path)) {
    return { kind: "video", reason: "video_url" };
  }

  if (SHORT_HOSTS.has(host) || /^\/t\//.test(path)) {
    return { kind: "short-link", url: url.toString() };
  }

  const music = path.match(/^\/music\/(.+)$/);
  if (music) {
    const slug = music[1];
    // The id is the trailing digit run. Not "the first number in the slug":
    // titles legitimately contain digits and hyphens ("song-2-remix-7238...").
    const tail = slug.match(/(\d{18,20})$/);
    if (tail) {
      return {
        kind: "sound",
        tiktokSoundId: tail[1],
        provisionalTitle: deslugTitle(slug),
      };
    }
    // A slug that is only the id, with no title part.
    const bare = slug.match(ID_RE);
    if (bare && bare[1] === slug) {
      return { kind: "sound", tiktokSoundId: bare[1], provisionalTitle: null };
    }
  }

  return { kind: "invalid", reason: "unrecognised" };
}

/** User-facing copy, kept beside the parser so the two cannot drift. */
export const SOUND_URL_ERRORS: Record<string, string> = {
  video_url:
    "That's a link to a video, not its sound. On the video, tap the spinning record in the corner (or the sound name at the bottom) to open the sound's page, then copy that link.",
  not_tiktok:
    "This doesn't look like a TikTok link. Paste a link that starts with tiktok.com/music/ — you'll find it on the sound's page.",
  unrecognised:
    "We couldn't find a sound in that link. Open the sound's own page on TikTok and copy the link from there.",
  short_link_unresolvable:
    "We couldn't open that short link right now. Try again, or paste the full tiktok.com/music/ link instead.",
};
