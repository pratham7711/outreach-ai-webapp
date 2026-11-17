"use client";

import { useCallback, useRef, useState } from "react";
import { Music2 } from "lucide-react";
import { SOUND_URL_ERRORS, parseSoundUrl } from "@/lib/trackers/soundUrl";
import { imgSrc } from "@/lib/postMedia";

/**
 * The Instagram audio field's checking, shared by the New Campaign form and
 * the campaign's audio settings, the way SpotifyLinkCheck is for the Spotify
 * field.
 *
 * Checked when the field is left or a link is pasted, through the same
 * resolve route the TikTok Import uses (POST /api/campaigns/audio/resolve),
 * which reads the audio page's own title, artist, cover and reel count.
 * Instagram answers 200 for an id that is no audio and publishes no count for
 * original audio, so "found" here means Instagram printed a number -- the one
 * a tracker can follow. What a value visibly is not (a reel, a TikTok sound)
 * is said at once, without a request.
 */

export const INSTAGRAM_AUDIO_LABEL = "Instagram audio";
export const INSTAGRAM_AUDIO_PLACEHOLDER = "https://www.instagram.com/reels/audio/…";
export const INSTAGRAM_AUDIO_HINT =
  "Optional. The track's audio page on Instagram. We read how many reels use it once a day. Licensed music only: Instagram shows no count for original audio.";

/** The two audio fields read from a public page: same check, same row. */
export type PageAudioPlatform = "INSTAGRAM" | "YOUTUBE";

export const YOUTUBE_AUDIO_LABEL = "YouTube audio";
export const YOUTUBE_AUDIO_PLACEHOLDER = "https://www.youtube.com/source/…/shorts";

const PAGE = {
  INSTAGRAM: { name: "Instagram", fallbackTitle: "Instagram audio", unreadable: "instagram_audio_unreadable", wrong: "not_instagram_audio" },
  YOUTUBE: { name: "YouTube", fallbackTitle: "YouTube audio", unreadable: "youtube_audio_unreadable", wrong: "not_youtube_audio" },
} as const;

export type InstagramAudioFound = {
  soundId: string;
  title: string | null;
  artist: string | null;
  coverImageUrl: string | null;
  usesCount: number | null;
  /** Instagram printed "2M", not a count. */
  usesRounded: boolean;
};

export type InstagramAudioCheck =
  | { status: "idle" }
  | { status: "checking"; raw: string }
  | { status: "found"; raw: string; audio: InstagramAudioFound }
  /** Not an Instagram audio, no such audio, or one with no count. `reason` is
   *  the parser's or the route's code, so the caller can say it in its own words. */
  | { status: "refused"; raw: string; message: string; reason: string | null }
  /** Instagram (or the server) did not answer. Says so, but blocks nothing: the save checks again. */
  | { status: "unverified"; raw: string; message: string };

const TIKTOK_IN_INSTAGRAM = "That's a TikTok sound. Put it in the TikTok sound field.";
const NOT_YOUTUBE = "That isn't a YouTube audio link.";
export const INSTAGRAM_IN_TIKTOK = "That's an Instagram audio. Put it in the Instagram audio field.";

/** What the parser alone can tell about a non-empty value: its refusal and the reason code, or null. */
export function instagramAudioLocalRefusal(
  value: string,
  platform: PageAudioPlatform = "INSTAGRAM",
): { message: string; reason: string } | null {
  const raw = value.trim();
  if (!raw) return null;
  const parsed = parseSoundUrl(raw);
  const wrong = { message: platform === "YOUTUBE" ? NOT_YOUTUBE : TIKTOK_IN_INSTAGRAM, reason: PAGE[platform].wrong };
  if (parsed.kind === "sound") return parsed.platform === platform ? null : wrong;
  if (parsed.kind === "short-link") return wrong;
  const reason = parsed.kind === "video" ? "video_url" : parsed.reason === "not_tiktok" ? "unrecognised" : parsed.reason;
  return { message: SOUND_URL_ERRORS[reason] ?? SOUND_URL_ERRORS.unrecognised, reason };
}

export function instagramAudioLocalError(value: string): string | null {
  return instagramAudioLocalRefusal(value)?.message ?? null;
}

/** "2,000,000 reels", or "≈2M reels" for a figure Instagram rounded. YouTube counts Shorts. */
export function reelsLabel(count: number | null | undefined, rounded: boolean, platform: PageAudioPlatform = "INSTAGRAM"): string | null {
  if (count == null) return null;
  const noun = platform === "YOUTUBE" ? (count === 1 && !rounded ? "Short" : "Shorts") : "reels";
  if (!rounded) return `${count.toLocaleString()} ${noun}`;
  const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(count);
  return `≈${compact} ${noun}`;
}

export function useInstagramAudioCheck(platform: PageAudioPlatform = "INSTAGRAM") {
  const [check, setCheck] = useState<InstagramAudioCheck>({ status: "idle" });
  /* The newest request wins, as in useSpotifyLinkCheck. */
  const seq = useRef(0);
  const lastRaw = useRef("");

  /* Resolves to what the check settled on, or null when it was not run (the
     same link again) or a newer one overtook it, so a caller can act on the
     answer -- leave a refused link out -- without watching state for it. */
  const run = useCallback(async (value: string): Promise<InstagramAudioCheck | null> => {
    const raw = value.trim();
    if (raw === lastRaw.current) return null;
    lastRaw.current = raw;
    const n = ++seq.current;
    const settle = (next: InstagramAudioCheck): InstagramAudioCheck | null => {
      if (n !== seq.current) return null;
      setCheck(next);
      return next;
    };
    if (!raw) return settle({ status: "idle" });
    const local = instagramAudioLocalRefusal(raw, platform);
    if (local) return settle({ status: "refused", raw, ...local });
    setCheck({ status: "checking", raw });
    try {
      const res = await fetch("/api/campaigns/audio/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: raw }),
      });
      const body = await res.json().catch(() => null);
      if (res.ok && body?.platform === platform && body.verified === true) {
        return settle({
          status: "found",
          raw,
          audio: {
            soundId: String(body.soundId),
            title: typeof body.provisionalTitle === "string" ? body.provisionalTitle : null,
            artist: typeof body.artist === "string" && body.artist ? body.artist : null,
            coverImageUrl: typeof body.coverImageUrl === "string" ? body.coverImageUrl : null,
            usesCount: typeof body.usesCount === "number" ? body.usesCount : null,
            usesRounded: body.usesRounded === true,
          },
        });
      }
      if (res.ok && body?.platform === platform) {
        return settle({ status: "unverified", raw, message: SOUND_URL_ERRORS[PAGE[platform].unreadable] });
      }
      if (res.ok) {
        return settle({
          status: "refused",
          raw,
          message: platform === "YOUTUBE" ? NOT_YOUTUBE : TIKTOK_IN_INSTAGRAM,
          reason: PAGE[platform].wrong,
        });
      }
      if (res.status === 400) {
        return settle({
          status: "refused",
          raw,
          message: body?.message ?? SOUND_URL_ERRORS.unrecognised,
          reason: typeof body?.error === "string" ? body.error : null,
        });
      }
      return settle({ status: "unverified", raw, message: body?.message ?? SOUND_URL_ERRORS[PAGE[platform].unreadable] });
    } catch {
      return settle({ status: "unverified", raw, message: "Could not reach the server." });
    }
  }, [platform]);

  /** The field was edited: whatever was checked described a different link. */
  const edited = useCallback((value: string) => {
    if (value.trim() === lastRaw.current) return;
    lastRaw.current = "";
    seq.current++;
    setCheck({ status: "idle" });
  }, []);

  /** A link put back after a paste was left out: its earlier answer returns, without asking again. */
  const restore = useCallback((previous: InstagramAudioCheck) => {
    seq.current++;
    lastRaw.current = previous.status === "idle" ? "" : previous.raw;
    setCheck(previous);
  }, []);

  return { check, run, edited, restore };
}

/** The audio Instagram described: cover, title, artist and reel count. */
export function InstagramAudioFoundRow({
  audio,
  note,
  platform = "INSTAGRAM",
}: {
  audio: InstagramAudioFound;
  note?: string | null;
  platform?: PageAudioPlatform;
}) {
  return (
    <div
      data-testid={platform === "YOUTUBE" ? "youtube-audio-found" : "instagram-audio-found"}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginTop: 8,
        padding: 8,
        borderRadius: 10,
        border: "1px solid var(--cc-border)",
        background: "var(--cc-card)",
        minWidth: 0,
      }}
    >
      {audio.coverImageUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element --
           The platform's CDN, a host next/image is not configured for. */
        <img
          src={imgSrc(audio.coverImageUrl, 72) ?? audio.coverImageUrl}
          alt=""
          width={36}
          height={36}
          style={{ width: 36, height: 36, borderRadius: 6, objectFit: "cover", flexShrink: 0 }}
        />
      ) : (
        <span
          aria-hidden="true"
          style={{
            width: 36, height: 36, borderRadius: 6, flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "var(--cc-bg)", color: "var(--cc-text-muted)",
          }}
        >
          <Music2 size={16} />
        </span>
      )}
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
        <span
          style={{
            fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}
        >
          {audio.title ?? PAGE[platform].fallbackTitle}
        </span>
        <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {[audio.artist, reelsLabel(audio.usesCount, audio.usesRounded, platform), note ?? null].filter(Boolean).join(" · ")}
        </span>
      </span>
    </div>
  );
}

/**
 * Under the field: the audio found, then the error, the check in progress, or
 * the hint. `localError` is the live parse of what is typed; it wins over an
 * older answer.
 */
export function InstagramAudioStatus({
  check,
  localError,
  hint = INSTAGRAM_AUDIO_HINT,
  note,
  platform = "INSTAGRAM",
}: {
  check: InstagramAudioCheck;
  localError: string | null;
  hint?: string;
  platform?: PageAudioPlatform;
  /** Appended to the found row, e.g. what its cover is used for. */
  note?: string | null;
}) {
  const message = localError ?? (check.status === "refused" || check.status === "unverified" ? check.message : null);
  return (
    <>
      {check.status === "found" && !localError && <InstagramAudioFoundRow audio={check.audio} note={note} platform={platform} />}
      {message ? (
        <p role="alert" style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-danger)", margin: "6px 0 0" }}>
          {message}
        </p>
      ) : check.status === "found" ? null : check.status === "checking" ? (
        <p role="status" style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "6px 0 0" }}>
          Checking the audio with {PAGE[platform].name}…
        </p>
      ) : (
        <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "6px 0 0" }}>{hint}</p>
      )}
    </>
  );
}
