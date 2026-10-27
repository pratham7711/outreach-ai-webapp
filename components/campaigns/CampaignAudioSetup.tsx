"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Music2, Check, ArrowLeft, Trash2, Info } from "lucide-react";
import { Button } from "@/components/ds";
import { imgSrc } from "@/lib/postMedia";
import { SOUND_URL_ERRORS, parseSoundUrl } from "@/lib/trackers/soundUrl";
import { parseSpotifyLink } from "@/lib/songs/spotifyLink";
import {
  SPOTIFY_LINK_LABEL,
  SPOTIFY_LINK_PLACEHOLDER,
  SpotifyLinkStatus,
  useSpotifyLinkCheck,
} from "@/components/campaigns/SpotifyLinkCheck";
import {
  INSTAGRAM_AUDIO_PLACEHOLDER,
  instagramAudioLocalRefusal,
  reelsLabel,
} from "@/components/campaigns/InstagramAudioCheck";
import { AudioFieldNotice } from "@/components/campaigns/AudioFieldNotice";
import {
  audioFieldFor,
  droppedNotice,
  isLastingRefusal,
  isLinkLike,
  movedNotice,
  type AudioField,
  type AudioFieldNoticeValue,
} from "@/lib/campaigns/audioLinkField";

/**
 * The campaign's audio, managed from Settings.
 *
 * This used to be a button on the Performance tab, which put "add something to
 * this campaign" inside a report. A campaign's sound is a property of the
 * campaign -- it is asked for when one is created, and changed here.
 *
 * Three things about the one release the campaign promotes, each tracked on
 * its own: the TikTok sound (videos using it), the Instagram audio (reels
 * using it) and the Spotify track (its play count). They live on the
 * campaign's song, so a campaign that shares its song with others changes
 * theirs too, and the panel says so.
 *
 * Adding a sound is a stepper rather than a single box because the link is
 * opaque until it is followed: a shortened TikTok URL says nothing about which
 * sound it is, and the old form committed on the strength of a paste. Now the
 * link is resolved first and shown, and only the second step writes. The
 * Spotify link has its own Save: it is set and changed without a stepper.
 *
 * A link pasted into the wrong section is handed to its own (lib/campaigns/
 * audioLinkField), which opens with it and checks it; a link that can never
 * give a number to follow is left out with a line saying why.
 */

/** What a section accepts from another: a link pasted there that belongs here. */
type LinkReceiver = { receive: (url: string, from: AudioField) => boolean };
type HandOff = (from: AudioField, to: AudioField, url: string) => boolean;

type Platform = "TIKTOK" | "INSTAGRAM";

type ResolvedSound = {
  platform: string;
  soundId: string;
  provisionalTitle: string | null;
  /* false when TikTok was asked and did not confirm the sound; the route then
     sends no title rather than one spelled out of the URL slug. Null for an
     Instagram audio Instagram did not answer for. */
  verified?: boolean | null;
  /* Read off the sound's own page by the resolve route, before anything is
     attached -- so the confirm step shows the artwork it is about to make this
     campaign's thumbnail rather than promising it for later. */
  artist: string | null;
  coverImageUrl: string | null;
  usesCount: number | null;
  usesRounded?: boolean;
};

type CurrentAudio = {
  title: string | null;
  artist: string | null;
  coverUrl: string | null;
  uses: number | null;
  usesRounded: boolean;
};

/** The song's linked Spotify track, from ?only=audio. `ready: false` while the database cannot store one. */
type SavedSpotifyLink = { ready: boolean; trackId: string | null; url: string | null };

const STEP_LABELS = ["Link", "Confirm", "Tracking"];

/** What each platform's section says and does differently. */
const SLOT = {
  TIKTOK: {
    heading: "TikTok sound",
    noun: "TikTok sound",
    otherNoun: "Instagram audio",
    placeholder: "https://www.tiktok.com/music/…",
    empty: "No TikTok sound. Add one and we track how many videos use it, and chart the curve on the report.",
    hint: "Paste the sound\u2019s own page, not a video that uses it. We follow shortened links.",
    uses: (n: number | null | undefined) => (n != null ? `${n.toLocaleString()} videos` : null),
  },
  INSTAGRAM: {
    heading: "Instagram audio",
    noun: "Instagram audio",
    otherNoun: "TikTok sound",
    placeholder: INSTAGRAM_AUDIO_PLACEHOLDER,
    empty: "No Instagram audio. Add the track\u2019s audio page and we track how many reels use it.",
    hint: "Open the audio from a reel and copy its link. Licensed music only: Instagram shows no count for original audio.",
    uses: (n: number | null | undefined, rounded = false) => reelsLabel(n, rounded),
  },
} as const;

const panelStyle = {
  background: "var(--cc-card)",
  border: "1px solid var(--cc-border)",
  borderRadius: 12,
  padding: 24,
} as const;

const sectionStyle = {
  borderTop: "1px solid var(--cc-border)",
  marginTop: 20,
  paddingTop: 20,
  minWidth: 0,
} as const;

const inputStyle = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--cc-border)",
  fontSize: "var(--cc-t-14)",
  color: "var(--cc-text)",
  background: "var(--cc-card)",
  boxSizing: "border-box" as const,
};

const labelStyle = {
  display: "block" as const,
  fontSize: "var(--cc-t-13)",
  fontWeight: 600 as const,
  color: "var(--cc-text)",
  marginBottom: 6,
};

const headingStyle = {
  fontSize: "var(--cc-t-14)",
  fontWeight: 700 as const,
  color: "var(--cc-text)",
  margin: "0 0 10px",
};

const mutedStyle = { fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: 0 } as const;
const alertStyle = { fontSize: "var(--cc-t-12)", color: "var(--cc-danger)", margin: 0 } as const;

function StepRail({ step }: { step: number }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
        {STEP_LABELS.map((label, i) => (
          <div
            key={label}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: i <= step ? "var(--cc-primary)" : "var(--cc-border)",
              transition: "background 0.2s",
            }}
          />
        ))}
      </div>
      <p style={{ fontSize: "var(--cc-t-11)", fontWeight: 700, letterSpacing: "0.4px", color: "var(--cc-text-muted)", margin: 0 }}>
        STEP {step + 1} OF {STEP_LABELS.length} — {STEP_LABELS[step].toUpperCase()}
      </p>
    </div>
  );
}

function Cover({ src, size }: { src: string | null; size: number }) {
  return (
    <div
      style={{
        width: size, height: size, borderRadius: 10, flexShrink: 0, overflow: "hidden",
        background: "var(--cc-bg)", display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      {src ? (
        /* eslint-disable-next-line @next/next/no-img-element -- a platform CDN
           (or our own proxy) URL, on a host next/image is not configured for. */
        <img src={src} alt="" width={size} height={size} style={{ objectFit: "cover", width: size, height: size }} />
      ) : (
        <Music2 size={Math.round(size / 2.8)} color="var(--cc-text-subtle)" aria-hidden="true" />
      )}
    </div>
  );
}

/** The local parse for a slot's own platform: a post link, or a link that is not a sound. */
function slotLocalRefusal(platform: Platform, raw: string): { message: string; reason: string } | null {
  if (platform === "INSTAGRAM") return instagramAudioLocalRefusal(raw);
  const parsed = parseSoundUrl(raw);
  if (parsed.kind === "sound" || parsed.kind === "short-link") return null;
  const reason = parsed.kind === "video" ? "video_url" : parsed.reason;
  return { message: SOUND_URL_ERRORS[reason] ?? SOUND_URL_ERRORS.unrecognised, reason };
}

/**
 * One platform's sound: what is tracked, with Change and Remove, or an Add
 * that opens the stepper in place.
 */
function SoundSlot({
  ref,
  campaignId,
  platform,
  current,
  blockedReason,
  takesThumbnail,
  onChanged,
  onHandOff,
}: {
  ref?: Ref<LinkReceiver>;
  campaignId: string;
  platform: Platform;
  current: CurrentAudio | null;
  /** Why this slot cannot take a sound right now; Add is held with this said. */
  blockedReason: string | null;
  /** Whether this sound's cover becomes the campaign's thumbnail when attached. */
  takesThumbnail: boolean;
  onChanged: () => Promise<void>;
  /** Gives a link that belongs to another section to that section. */
  onHandOff: HandOff;
}) {
  const copy = SLOT[platform];
  const id = `audio-setup-${platform.toLowerCase()}`;
  const [adding, setAdding] = useState(false);
  const [step, setStep] = useState(0);
  const [url, setUrl] = useState("");
  const [resolved, setResolved] = useState<ResolvedSound | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<AudioFieldNoticeValue | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);

  function reset() {
    setAdding(false);
    setStep(0);
    setUrl("");
    setResolved(null);
    setError(null);
    setNotice(null);
  }

  function leaveOut(reason: string | null | undefined, message: string) {
    setUrl("");
    setError(null);
    setNotice(droppedNotice(reason, message));
  }

  /* The link goes to the section its site belongs to; here, the same parser
     the server runs names a post link before a round trip is spent. It is not
     the authority: a short link still has to be followed server-side, so a
     clean parse only permits the request. */
  async function resolveLink(value: string, received = false) {
    const raw = value.trim();
    if (!raw) return;
    const to = audioFieldFor(raw);
    if (to === null) {
      leaveOut("not_tiktok", SOUND_URL_ERRORS.not_tiktok);
      return;
    }
    if (to !== platform) {
      if (onHandOff(platform, to, raw)) reset();
      else leaveOut(null, `The ${to === "SPOTIFY" ? "Spotify link" : SLOT[to].noun} can't be added here yet. Try again later.`);
      return;
    }
    if (!received) setNotice(null);
    const local = slotLocalRefusal(platform, raw);
    if (local) {
      leaveOut(local.reason, local.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns/audio/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: raw }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const message = json?.message ?? "That link could not be read.";
        if (res.status === 400 && isLastingRefusal(json?.error)) leaveOut(json?.error, message);
        else setError(message);
        return;
      }
      /* A short link only says where it goes once followed. */
      if (json?.platform && json.platform !== platform) {
        if (onHandOff(platform, json.platform as AudioField, raw)) reset();
        else leaveOut(null, "That link is for the other platform's section.");
        return;
      }
      setResolved(json);
      setStep(1);
    } catch {
      setError("That link could not be read.");
    } finally {
      setBusy(false);
    }
  }

  /* Opened by another section with a link that belongs here. */
  useImperativeHandle(ref, () => ({
    receive(link: string, from: AudioField) {
      if (blockedReason) return false;
      setAdding(true);
      setStep(0);
      setUrl(link);
      setResolved(null);
      setError(null);
      setNotice(movedNotice(from, false));
      requestAnimationFrame(() => sectionRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" }));
      void resolveLink(link, true);
      return true;
    },
  }));

  async function attach() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        /* The cover travels with the attach when this sound is the one the
           campaign's picture comes from: the TikTok sound's, or the Instagram
           audio's on a campaign with no TikTok sound. Omitted when the page
           would not answer, which leaves whatever was there. */
        body: JSON.stringify({
          audioUrl: url.trim(),
          ...(takesThumbnail && resolved?.coverImageUrl ? { thumbnailUrl: resolved.coverImageUrl } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.message ?? json?.error ?? "That link could not be attached.");
        setStep(0);
        return;
      }
      setStep(2);
      await onChanged();
    } catch {
      setError("That link could not be attached.");
      setStep(0);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      /* Empties this platform's slot on the song, never a delete: the tracker
         and its usage history are the sound's, and other campaigns may read
         them. A song left with nothing at all is detached instead. */
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ removeAudio: platform }),
      });
      if (!res.ok) {
        setError(`That ${copy.noun} could not be removed.`);
        return;
      }
      reset();
      await onChanged();
    } catch {
      setError(`That ${copy.noun} could not be removed.`);
    } finally {
      setBusy(false);
    }
  }

  // ── Tracked, and not being changed ──────────────────────────────────────
  if (current && !adding) {
    const cover = current.coverUrl ? imgSrc(current.coverUrl, 96) ?? current.coverUrl : null;
    const usesText = copy.uses(current.uses, current.usesRounded);
    return (
      <section aria-labelledby={`${id}-h`} style={sectionStyle}>
        <h4 id={`${id}-h`} style={headingStyle}>{copy.heading}</h4>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <Cover src={cover} size={52} />
          <div style={{ minWidth: 0, flex: "1 1 180px" }}>
            <p style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", margin: 0 }}>
              {current.title ?? "Tracking this sound"}
            </p>
            <p style={{ ...mutedStyle, marginTop: 2 }}>
              {/* Both fill in from the first reading of the sound page, so a
                  sound attached seconds ago legitimately has neither yet. */}
              {current.artist || "Artist fills in after the first reading"}
              {usesText ? ` · ${usesText}` : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" onClick={() => { setAdding(true); setStep(0); }} disabled={busy}>
              Change
            </Button>
            <Button variant="secondary" iconLeft={<Trash2 size={14} />} onClick={remove} disabled={busy}>
              Remove
            </Button>
          </div>
        </div>
        {error && <p role="alert" style={{ ...alertStyle, marginTop: 10 }}>{error}</p>}
      </section>
    );
  }

  // ── Nothing tracked, and the stepper is closed ─────────────────────────
  if (!adding) {
    return (
      <section aria-labelledby={`${id}-h`} style={sectionStyle}>
        <h4 id={`${id}-h`} style={headingStyle}>{copy.heading}</h4>
        <p style={{ ...mutedStyle, fontSize: "var(--cc-t-13)", marginBottom: 12 }}>{copy.empty}</p>
        <Button variant="secondary" iconLeft={<Music2 size={15} />} onClick={() => setAdding(true)} disabled={blockedReason !== null}>
          Add {copy.noun}
        </Button>
        {blockedReason && <p style={{ ...mutedStyle, marginTop: 8 }}>{blockedReason}</p>}
      </section>
    );
  }

  // ── The stepper ─────────────────────────────────────────────────────────
  return (
    <section ref={sectionRef} aria-labelledby={`${id}-h`} style={sectionStyle}>
      <h4 id={`${id}-h`} style={headingStyle}>{current ? `Change ${copy.noun}` : `Add ${copy.noun}`}</h4>
      <StepRail step={step} />

      {step === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label htmlFor={`${id}-url`} style={labelStyle}>{copy.heading} link</label>
            <input
              id={`${id}-url`}
              type="text"
              inputMode="url"
              autoComplete="off"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
                setNotice(null);
              }}
              onPaste={(e) => {
                /* The pasted link takes the whole field, not the caret's place
                   in it, and is checked at once (see the New Campaign form). */
                const text = e.clipboardData.getData("text").trim();
                if (!isLinkLike(text)) return;
                e.preventDefault();
                setUrl(text);
                setError(null);
                setNotice(null);
                void resolveLink(text);
              }}
              placeholder={copy.placeholder}
              aria-invalid={error !== null}
              style={inputStyle}
            />
            {notice && <AudioFieldNotice notice={notice} />}
          </div>
          {error ? (
            <p role="alert" style={alertStyle}>{error}</p>
          ) : notice?.tone === "dropped" ? null : busy ? (
            <p role="status" style={mutedStyle}>Checking the link…</p>
          ) : (
            <p style={mutedStyle}>{copy.hint}</p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={() => void resolveLink(url)} disabled={busy || !url.trim()}>
              {busy ? "Checking..." : "Continue"}
            </Button>
            <Button variant="secondary" onClick={reset} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}

      {step === 1 && resolved && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {notice?.tone === "moved" && <AudioFieldNotice notice={notice} />}
          <p style={{ ...mutedStyle, fontSize: "var(--cc-t-13)" }}>
            This is the {platform === "INSTAGRAM" ? "audio" : "sound"} we will track. Nothing has been attached yet.
          </p>
          {resolved.verified === false && (
            <p role="status" style={alertStyle}>
              We couldn&apos;t find or verify this sound on TikTok. Check the link; if it is right, its title and
              cover fill in once TikTok answers.
            </p>
          )}
          {platform === "INSTAGRAM" && resolved.verified == null && (
            <p role="status" style={alertStyle}>
              Instagram didn&apos;t answer, so this audio isn&apos;t confirmed yet. If the link is right, its title,
              cover and reel count fill in once Instagram does.
            </p>
          )}
          <div style={{ background: "var(--cc-bg)", borderRadius: 10, padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
            {resolved.coverImageUrl && (
              /* eslint-disable-next-line @next/next/no-img-element -- a signed
                 platform CDN URL on a host next/image is not configured for. */
              <img
                src={resolved.coverImageUrl}
                alt=""
                width={52}
                height={52}
                style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", margin: 0 }}>
                {resolved.provisionalTitle ??
                  (resolved.verified === false ? "Sound not verified" : platform === "INSTAGRAM" ? "Instagram audio" : "Untitled sound")}
              </p>
              <p style={{ ...mutedStyle, marginTop: 4 }}>
                {[
                  resolved.artist || null,
                  /* `!= null` inside copy.uses: this object is parsed from a
                     fetch response, so a field the route stops sending arrives
                     as undefined, and .toLocaleString() on it throws and
                     blanks the whole step. */
                  copy.uses(resolved.usesCount, resolved.usesRounded === true),
                  `${resolved.platform} · ${platform === "INSTAGRAM" ? "audio" : "sound"} ${resolved.soundId}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
          <p style={mutedStyle}>
            {!takesThumbnail
              ? "The campaign keeps its thumbnail: it comes from the TikTok sound."
              : resolved.coverImageUrl
                ? "This cover art becomes the campaign\u2019s thumbnail."
                : "The cover art could not be read, so the campaign keeps the thumbnail it has."}
          </p>
          {error && <p role="alert" style={alertStyle}>{error}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={attach} disabled={busy}>
              {busy ? "Attaching..." : "Start tracking"}
            </Button>
            <Button variant="secondary" iconLeft={<ArrowLeft size={14} />} onClick={() => setStep(0)} disabled={busy}>
              Back
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", margin: 0 }}>
            <Check size={16} color="var(--cc-primary)" aria-hidden="true" /> Tracking this {platform === "INSTAGRAM" ? "audio" : "sound"}
          </p>
          <p style={mutedStyle}>
            Usage is read once a day, and its card is now on this campaign&apos;s Performance section and on
            every client report shared from it.
          </p>
          <div>
            <Button variant="secondary" onClick={reset}>Done</Button>
          </div>
        </div>
      )}
    </section>
  );
}


/** The track id a value names, "" for empty, null when only the server can tell (a short link) or it is not a track. */
function linkedTrackOf(value: string): string | null {
  const raw = value.trim();
  if (!raw) return "";
  const parsed = parseSpotifyLink(raw);
  return parsed.kind === "track" ? parsed.trackId : null;
}

function SpotifyLinkSettings({
  ref,
  campaignId,
  saved,
  onSaved,
  onHandOff,
}: {
  ref?: Ref<LinkReceiver>;
  campaignId: string;
  saved: SavedSpotifyLink;
  onSaved: () => Promise<void>;
  onHandOff: HandOff;
}) {
  const [value, setValue] = useState(saved.url ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [notice, setNotice] = useState<AudioFieldNoticeValue | null>(null);
  const spotify = useSpotifyLinkCheck();
  const { run, edited } = spotify;

  /* The saved link is shown as found -- cover and title -- so it is plain
     which song is linked, not just a URL. One oEmbed call per visit. */
  useEffect(() => {
    setValue(saved.url ?? "");
    if (saved.url) void run(saved.url);
  }, [saved.url, run]);

  const refused = spotify.check.status === "refused" && spotify.check.raw === value.trim();
  /* Unchanged when it names the saved track (a pasted ?si= copy of the same
     link included), or both are empty. A short link is never "unchanged":
     only the server can say where it goes. */
  const unchanged = linkedTrackOf(value) === (saved.trackId ?? "");
  const canSave = saved.ready && !busy && !unchanged && !refused && spotify.check.status !== "checking";

  /* Back to the saved link, shown as found, after a paste that is not kept. */
  function restoreSaved() {
    setValue(saved.url ?? "");
    edited("");
    if (saved.url) void run(saved.url);
  }

  /* A paste, or leaving the field: a TikTok or Instagram link goes to its own
     section; a Spotify link that is not a track is left out with why. */
  async function place(raw: string, received = false) {
    const link = raw.trim();
    if (!link) return;
    const to = audioFieldFor(link);
    if (to === null) {
      restoreSaved();
      setNotice(droppedNotice("not_tiktok", "That isn't a Spotify track link.", Boolean(saved.url)));
      return;
    }
    if (to !== "SPOTIFY") {
      restoreSaved();
      setNotice(onHandOff("SPOTIFY", to, link) ? null : droppedNotice(null, "That link's section can't take it yet. Try again later."));
      return;
    }
    if (!received) setNotice(null);
    const result = await run(link);
    if (result?.status === "refused") {
      restoreSaved();
      setNotice(droppedNotice(result.reason, result.message, Boolean(saved.url)));
    }
  }

  useImperativeHandle(ref, () => ({
    receive(link: string, from: AudioField) {
      if (!saved.ready) return false;
      setValue(link);
      setDone(null);
      setError(null);
      setNotice(movedNotice(from, Boolean(saved.url) && linkedTrackOf(link) !== saved.trackId));
      void place(link, true);
      return true;
    },
  }));

  async function save() {
    setBusy(true);
    setError(null);
    setDone(null);
    const next = value.trim();
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spotifyUrl: next || null }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.message ?? json?.error ?? "That link could not be saved.");
        return;
      }
      setDone(next ? "Saved. Its play count is read once a day." : "Removed. The track is matched by title and artist again.");
      await onSaved();
    } catch {
      setError("That link could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="audio-setup-spotify-h" style={sectionStyle}>
      <h4 id="audio-setup-spotify-h" style={headingStyle}>Spotify track</h4>
      {/* The section heading says what this is; the label stays for the input's name. */}
      <label htmlFor="audio-setup-spotify" className="sr-only">{SPOTIFY_LINK_LABEL}</label>
      {/* Save sits on the field, as Import does on the sound link in the New
          Campaign form: saving is what you do with the link just pasted. */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          id="audio-setup-spotify"
          type="text"
          inputMode="url"
          autoComplete="off"
          value={value}
          disabled={!saved.ready}
          onChange={(e) => {
            setValue(e.target.value);
            setDone(null);
            setError(null);
            setNotice(null);
            edited(e.target.value);
          }}
          onPaste={(e) => {
            const text = e.clipboardData.getData("text").trim();
            if (!isLinkLike(text)) return;
            e.preventDefault();
            setValue(text);
            setDone(null);
            setError(null);
            setNotice(null);
            void place(text);
          }}
          onBlur={(e) => void place(e.target.value)}
          placeholder={SPOTIFY_LINK_PLACEHOLDER}
          aria-invalid={refused || error !== null}
          style={{ ...inputStyle, flex: 1, minWidth: 0 }}
        />
        <Button variant="secondary" onClick={save} loading={busy} disabled={!canSave}>
          Save
        </Button>
      </div>
      {notice && <AudioFieldNotice notice={notice} />}
      <SpotifyLinkStatus
        check={spotify.check}
        localError={error}
        hint={saved.ready ? undefined : "Spotify links can't be saved yet. Try again later."}
      />
      {done && !error && (
        <p role="status" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "6px 0 0" }}>
          <Check size={13} color="var(--cc-primary)" aria-hidden="true" /> {done}
        </p>
      )}
    </section>
  );
}

export function CampaignAudioSetup({ campaignId }: { campaignId: string }) {
  const [tiktok, setTiktok] = useState<CurrentAudio | null>(null);
  const [instagram, setInstagram] = useState<CurrentAudio | null>(null);
  /* False while the database has no Instagram slot: an older song's one
     sound still shows, it just cannot be joined by the other platform's. */
  const [slotsReady, setSlotsReady] = useState(true);
  const [sharedWith, setSharedWith] = useState(0);
  const [spotifyLink, setSpotifyLink] = useState<SavedSpotifyLink>({ ready: true, trackId: null, url: null });
  const [loaded, setLoaded] = useState(false);
  const receivers = {
    TIKTOK: useRef<LinkReceiver>(null),
    INSTAGRAM: useRef<LinkReceiver>(null),
    SPOTIFY: useRef<LinkReceiver>(null),
  };
  const handOff: HandOff = (_from, to, url) => receivers[to].current?.receive(url, _from) ?? false;

  /* The performance report already resolves each sound's cover, title, artist
     and usage; reading it here keeps one definition of "this campaign's audio"
     rather than a second query that could disagree with the cards.
     `only=audio` asks for that part alone, without the post rows and the
     usage chart. */
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/performance?only=audio`);
      if (!res.ok) return;
      const data = await res.json();
      const toCurrent = (a: Record<string, unknown> | null | undefined): CurrentAudio | null =>
        a
          ? {
              title: typeof a.title === "string" ? a.title : null,
              artist: typeof a.artist === "string" ? a.artist : null,
              coverUrl: typeof a.coverUrl === "string" ? a.coverUrl : null,
              uses: typeof a.uses === "number" ? a.uses : null,
              usesRounded: a.usesRounded === true,
            }
          : null;
      setTiktok(toCurrent(data?.audio));
      setInstagram(toCurrent(data?.instagramAudio));
      setSlotsReady(data?.instagramReady !== false);
      setSharedWith(typeof data?.sharedWith === "number" ? data.sharedWith : 0);
      setSpotifyLink({
        ready: data?.spotify?.ready !== false,
        trackId: typeof data?.spotify?.trackId === "string" ? data.spotify.trackId : null,
        url: typeof data?.spotify?.url === "string" ? data.spotify.url : null,
      });
    } finally {
      setLoaded(true);
    }
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!loaded) return null;

  /* Until the Instagram slot exists a song holds one sound, so adding the
     other platform's would replace it rather than sit beside it. */
  const blocked = (other: CurrentAudio | null, otherNoun: string) =>
    !slotsReady && other ? `Can't be added beside the ${otherNoun} yet. Try again later.` : null;

  return (
    <div style={panelStyle}>
      <h3 style={{ fontSize: "var(--cc-t-15)", fontWeight: 700, color: "var(--cc-text)", margin: "0 0 6px" }}>Campaign audio</h3>
      <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", margin: 0 }}>
        The track this campaign promotes, followed on each platform you link: videos on TikTok, reels on
        Instagram, plays on Spotify. Each is read once a day and charted on the report.
      </p>
      {sharedWith > 0 && (
        <p
          role="note"
          style={{
            display: "flex", alignItems: "flex-start", gap: 8, margin: "14px 0 0", padding: "10px 12px",
            borderRadius: 10, background: "var(--cc-bg)", fontSize: "var(--cc-t-12)", color: "var(--cc-text)",
          }}
        >
          <Info size={14} color="var(--cc-primary)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            This track is also on {sharedWith} other {sharedWith === 1 ? "campaign" : "campaigns"}. Links you
            change here change there too.
          </span>
        </p>
      )}

      <SoundSlot
        ref={receivers.TIKTOK}
        campaignId={campaignId}
        platform="TIKTOK"
        current={tiktok}
        blockedReason={blocked(instagram, SLOT.TIKTOK.otherNoun)}
        takesThumbnail
        onChanged={load}
        onHandOff={handOff}
      />
      <SoundSlot
        ref={receivers.INSTAGRAM}
        campaignId={campaignId}
        platform="INSTAGRAM"
        current={instagram}
        blockedReason={blocked(tiktok, SLOT.INSTAGRAM.otherNoun)}
        takesThumbnail={!tiktok}
        onChanged={load}
        onHandOff={handOff}
      />
      <SpotifyLinkSettings ref={receivers.SPOTIFY} campaignId={campaignId} saved={spotifyLink} onSaved={load} onHandOff={handOff} />
    </div>
  );
}
