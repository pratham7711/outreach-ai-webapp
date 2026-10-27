"use client";

import { useCallback, useRef, useState, type ChangeEvent } from "react";
import { Disc3 } from "lucide-react";
import { SPOTIFY_LINK_ERRORS, parseSpotifyLink } from "@/lib/songs/spotifyLink";

/**
 * The Spotify link field's checking, shared by the New Campaign form and the
 * campaign's audio settings. Each of those draws its own input, in its own
 * file's style; this is what happens around it.
 *
 * The link is checked when the field is left or a link is pasted, never on
 * every keystroke: it is a round trip to Spotify (GET /api/songs/spotify-check),
 * and a half-typed URL is not worth one. What a link visibly is not -- an
 * album, a playlist, another site -- is said at once, by the same parser the
 * server runs, without asking anybody.
 */

export const SPOTIFY_LINK_LABEL = "Spotify link";
export const SPOTIFY_LINK_PLACEHOLDER = "https://open.spotify.com/track/…";
export const SPOTIFY_LINK_HINT =
  "Optional. The song's Spotify track link. We read its play count once a day. Leave it empty and we match the track by title and artist.";

export type SpotifyCheck =
  | { status: "idle" }
  | { status: "checking"; raw: string }
  | { status: "found"; raw: string; trackId: string; url: string; title: string | null; thumbnailUrl: string | null }
  /** The link is no good: not a track, or Spotify has no such track. Blocks a save.
   *  `reason` is the parser's or the route's code. */
  | { status: "refused"; raw: string; message: string; reason: string | null }
  /** Spotify (or the server) did not answer. Says so, but blocks nothing: the save re-parses the link. */
  | { status: "unverified"; raw: string; message: string };

/** What the parser alone can tell about a non-empty value. A short link passes: only the server can follow it. */
export function spotifyLinkLocalError(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;
  const parsed = parseSpotifyLink(raw);
  return parsed.kind === "invalid" ? SPOTIFY_LINK_ERRORS[parsed.reason] : null;
}

/** A paste lands as one change event with this inputType; that is when to check, as well as on blur. */
export function isPaste(e: ChangeEvent<HTMLInputElement>): boolean {
  return (e.nativeEvent as InputEvent | undefined)?.inputType === "insertFromPaste";
}

export function useSpotifyLinkCheck() {
  const [check, setCheck] = useState<SpotifyCheck>({ status: "idle" });
  /* The newest request wins: a blur that follows a paste of the same link is
     not asked twice, and an older answer arriving late cannot overwrite a
     newer one. */
  const seq = useRef(0);
  const lastRaw = useRef("");

  /* Resolves to what the check settled on, or null when it was not run (the
     same link again) or a newer one overtook it, as in useInstagramAudioCheck. */
  const run = useCallback(async (value: string): Promise<SpotifyCheck | null> => {
    const raw = value.trim();
    if (raw === lastRaw.current) return null;
    lastRaw.current = raw;
    const n = ++seq.current;
    const settle = (next: SpotifyCheck): SpotifyCheck | null => {
      if (n !== seq.current) return null;
      setCheck(next);
      return next;
    };
    if (!raw) return settle({ status: "idle" });
    const parsed = parseSpotifyLink(raw);
    if (parsed.kind === "invalid") {
      return settle({ status: "refused", raw, message: SPOTIFY_LINK_ERRORS[parsed.reason], reason: parsed.reason });
    }
    setCheck({ status: "checking", raw });
    try {
      const res = await fetch(`/api/songs/spotify-check?url=${encodeURIComponent(raw)}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (res.ok && typeof body?.trackId === "string") {
        return settle({
          status: "found",
          raw,
          trackId: body.trackId,
          url: body.url,
          title: typeof body.title === "string" ? body.title : null,
          thumbnailUrl: typeof body.thumbnailUrl === "string" ? body.thumbnailUrl : null,
        });
      }
      if (res.status === 400 || res.status === 404) {
        return settle({
          status: "refused",
          raw,
          message: body?.message ?? SPOTIFY_LINK_ERRORS.not_track,
          reason: typeof body?.error === "string" ? body.error : null,
        });
      }
      return settle({ status: "unverified", raw, message: body?.message ?? "Spotify didn't answer. Try again in a moment." });
    } catch {
      return settle({ status: "unverified", raw, message: "Could not reach the server." });
    }
  }, []);

  /** The field was edited: whatever was checked described a different link. */
  const edited = useCallback((value: string) => {
    if (value.trim() === lastRaw.current) return;
    lastRaw.current = "";
    seq.current++;
    setCheck({ status: "idle" });
  }, []);

  /** A link put back after a paste was left out: its earlier answer returns, without asking again. */
  const restore = useCallback((previous: SpotifyCheck) => {
    seq.current++;
    lastRaw.current = previous.status === "idle" ? "" : previous.raw;
    setCheck(previous);
  }, []);

  return { check, run, edited, restore };
}

/**
 * Under the field: the track the link names (cover, title, "on Spotify"),
 * then the error, the check in progress, or the hint. `localError` is the
 * live parse of what is typed; it wins over an older answer.
 */
export function SpotifyLinkStatus({
  check,
  localError,
  hint = SPOTIFY_LINK_HINT,
}: {
  check: SpotifyCheck;
  localError: string | null;
  hint?: string;
}) {
  const message =
    localError ?? (check.status === "refused" || check.status === "unverified" ? check.message : null);
  return (
    <>
      {check.status === "found" && !localError && (
        <a
          href={check.url}
          target="_blank"
          rel="noopener noreferrer"
          data-testid="spotify-link-found"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 8,
            padding: 8,
            borderRadius: 10,
            border: "1px solid var(--cc-border)",
            background: "var(--cc-card)",
            textDecoration: "none",
            minWidth: 0,
          }}
        >
          {check.thumbnailUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element --
               Spotify's image CDN, a host next/image is not configured for. */
            <img
              src={check.thumbnailUrl}
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
              <Disc3 size={16} />
            </span>
          )}
          <span style={{ display: "flex", alignItems: "baseline", gap: 4, minWidth: 0, fontSize: "var(--cc-t-13)" }}>
            <span
              style={{
                fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0,
              }}
            >
              {check.title ?? "Spotify track"}
            </span>
            <span style={{ color: "var(--cc-text-muted)", flexShrink: 0 }}>on Spotify</span>
          </span>
        </a>
      )}
      {message ? (
        <p role="alert" style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-danger)", margin: "6px 0 0" }}>
          {message}
        </p>
      ) : check.status === "checking" ? (
        <p role="status" style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "6px 0 0" }}>
          Checking the link with Spotify…
        </p>
      ) : (
        <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "6px 0 0" }}>{hint}</p>
      )}
    </>
  );
}
