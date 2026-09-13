"use client";

import { useCallback, useEffect, useState } from "react";
import { Music2, Check, ArrowLeft, Trash2 } from "lucide-react";
import { Button } from "@/components/ds";
import { imgSrc } from "@/lib/postMedia";
import { SOUND_URL_ERRORS, parseSoundUrl } from "@/lib/trackers/soundUrl";

/**
 * The campaign's audio, managed from Settings.
 *
 * This used to be a button on the Performance tab, which put "add something to
 * this campaign" inside a report. A campaign's sound is a property of the
 * campaign -- it is asked for when one is created, and changed here.
 *
 * Adding one is a stepper rather than a single box because the link is opaque
 * until it is followed: a shortened TikTok URL says nothing about which sound
 * it is, and the old form committed on the strength of a paste. Now the link is
 * resolved first and shown, and only the second step writes.
 */

type ResolvedSound = {
  platform: string;
  soundId: string;
  provisionalTitle: string | null;
  /* Read off the sound's own page by the resolve route, before anything is
     attached -- so the confirm step shows the artwork it is about to make this
     campaign's thumbnail rather than promising it for later. */
  artist: string | null;
  coverImageUrl: string | null;
  usesCount: number | null;
};

type CurrentAudio = {
  title: string | null;
  artist: string | null;
  coverUrl: string | null;
  uses: number | null;
};

const STEP_LABELS = ["Sound link", "Confirm", "Tracking"];

const panelStyle = {
  background: "var(--cc-card)",
  border: "1px solid var(--cc-border)",
  borderRadius: 12,
  padding: 24,
} as const;

const inputStyle = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--cc-border)",
  fontSize: 14,
  color: "var(--cc-text)",
  background: "var(--cc-card)",
  boxSizing: "border-box" as const,
};

const labelStyle = {
  display: "block" as const,
  fontSize: 13,
  fontWeight: 600 as const,
  color: "var(--cc-text)",
  marginBottom: 6,
};

function StepRail({ step }: { step: number }) {
  return (
    <div style={{ marginBottom: 20 }}>
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
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.4px", color: "var(--cc-text-muted)", margin: 0 }}>
        STEP {step + 1} OF {STEP_LABELS.length} — {STEP_LABELS[step].toUpperCase()}
      </p>
    </div>
  );
}

export function CampaignAudioSetup({ campaignId }: { campaignId: string }) {
  const [audio, setAudio] = useState<CurrentAudio | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [adding, setAdding] = useState(false);

  const [step, setStep] = useState(0);
  const [url, setUrl] = useState("");
  const [resolved, setResolved] = useState<ResolvedSound | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* The performance report already resolves the sound's cover, title, artist
     and usage; reading it here keeps one definition of "this campaign's audio"
     rather than a second query that could disagree with the card. */
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/performance`);
      if (!res.ok) return;
      const data = await res.json();
      setAudio(
        data?.audio
          ? {
              title: data.audio.title ?? null,
              artist: data.audio.artist ?? null,
              coverUrl: data.audio.coverUrl ?? null,
              uses: data.audio.uses ?? null,
            }
          : null
      );
    } finally {
      setLoaded(true);
    }
  }, [campaignId]);

  useEffect(() => {
    load();
  }, [load]);

  /* The same parser the server runs, so a post link is named as one before a
     round trip is spent. It is not the authority: a short link still has to be
     followed server-side, so a clean parse only permits the request. */
  const localError = (() => {
    const raw = url.trim();
    if (!raw) return null;
    const parsed = parseSoundUrl(raw);
    if (parsed.kind === "sound" || parsed.kind === "short-link") return null;
    const reason =
      parsed.kind === "video" ? "video_url" : parsed.kind === "invalid" ? parsed.reason : "unrecognised";
    return SOUND_URL_ERRORS[reason] ?? SOUND_URL_ERRORS.unrecognised;
  })();

  function reset() {
    setAdding(false);
    setStep(0);
    setUrl("");
    setResolved(null);
    setError(null);
  }

  async function resolveLink() {
    const raw = url.trim();
    if (!raw || localError) return;
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
        setError(json?.message ?? "That link could not be read.");
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

  async function attach() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        /* The cover travels with the attach. Campaign.thumbnailUrl is the
           sound's artwork now, not a URL anybody types, so changing a
           campaign's audio changes the picture the list draws for it. Omitted
           when the page would not answer, which leaves whatever was there. */
        body: JSON.stringify({
          audioUrl: url.trim(),
          ...(resolved?.coverImageUrl ? { thumbnailUrl: resolved.coverImageUrl } : {}),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.message ?? json?.error ?? "That link could not be attached.");
        setStep(0);
        return;
      }
      setStep(2);
      await load();
    } catch {
      setError("That link could not be attached.");
      setStep(0);
    } finally {
      setBusy(false);
    }
  }

  async function detach() {
    setBusy(true);
    setError(null);
    try {
      /* songId: null, not a delete. The Song and its TikTokSound outlive this
         campaign -- other campaigns may be reading the same tracker, and the
         usage history is the sound's, not ours to throw away. */
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ songId: null }),
      });
      if (!res.ok) {
        setError("That audio could not be removed.");
        return;
      }
      setAudio(null);
      reset();
    } catch {
      setError("That audio could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  // ── The campaign already has audio ──────────────────────────────────────
  if (audio && !adding) {
    const cover = audio.coverUrl ? imgSrc(audio.coverUrl, 96) ?? audio.coverUrl : null;
    return (
      <div style={panelStyle}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 16 }}>Campaign audio</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <div
            style={{
              width: 56, height: 56, borderRadius: 10, flexShrink: 0, overflow: "hidden",
              background: "var(--cc-bg)", display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {cover ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={cover} alt="" width={56} height={56} style={{ objectFit: "cover", width: 56, height: 56 }} />
            ) : (
              <Music2 size={20} color="var(--cc-text-subtle)" aria-hidden="true" />
            )}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>
              {audio.title ?? "Tracking this sound"}
            </p>
            <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "2px 0 0" }}>
              {/* Both fill in from the first reading of the sound page, so a
                  sound attached seconds ago legitimately has neither yet. */}
              {audio.artist ?? "Artist fills in after the first reading"}
              {audio.uses != null ? ` · ${audio.uses.toLocaleString()} videos` : ""}
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" onClick={() => { setAdding(true); setStep(0); }} disabled={busy}>
              Change
            </Button>
            <Button variant="secondary" iconLeft={<Trash2 size={14} />} onClick={detach} disabled={busy}>
              Remove
            </Button>
          </div>
        </div>
        <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "14px 0 0" }}>
          The sound&apos;s usage is read once a day. Its cover art is this campaign&apos;s thumbnail
          wherever one has not been set by hand.
        </p>
        {error && (
          <p role="alert" style={{ fontSize: 12, color: "var(--cc-danger)", margin: "10px 0 0" }}>{error}</p>
        )}
      </div>
    );
  }

  // ── No audio, and the stepper is closed ─────────────────────────────────
  if (!adding) {
    return (
      <div style={panelStyle}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 6 }}>Campaign audio</h3>
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "0 0 16px" }}>
          This campaign promotes no sound. Add one and we track how many videos use it, show the
          usage curve on the report, and take the campaign&apos;s thumbnail from its cover art.
        </p>
        <Button iconLeft={<Music2 size={15} />} onClick={() => setAdding(true)}>
          Add audio
        </Button>
      </div>
    );
  }

  // ── The stepper ─────────────────────────────────────────────────────────
  return (
    <div style={panelStyle}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 16 }}>
        {audio ? "Change campaign audio" : "Add campaign audio"}
      </h3>
      <StepRail step={step} />

      {step === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label htmlFor="audio-setup-url" style={labelStyle}>Sound link</label>
            <input
              id="audio-setup-url"
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="tiktok.com/music/... or instagram.com/reels/audio/..."
              aria-invalid={localError !== null || error !== null}
              style={inputStyle}
            />
          </div>
          {localError || error ? (
            <p role="alert" style={{ fontSize: 12, color: "var(--cc-danger)", margin: 0 }}>
              {localError ?? error}
            </p>
          ) : (
            <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>
              Paste the sound&apos;s own page, not a video that uses it. We follow shortened links.
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={resolveLink} disabled={busy || !url.trim() || localError !== null}>
              {busy ? "Checking..." : "Continue"}
            </Button>
            <Button variant="secondary" onClick={reset} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}

      {step === 1 && resolved && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>
            This is the sound we will track. Nothing has been attached yet.
          </p>
          <div style={{ background: "var(--cc-bg)", borderRadius: 10, padding: 14, display: "flex", alignItems: "center", gap: 12 }}>
            {resolved.coverImageUrl && (
              /* eslint-disable-next-line @next/next/no-img-element -- a signed
                 TikTok CDN URL on a host next/image is not configured for. */
              <img
                src={resolved.coverImageUrl}
                alt=""
                width={52}
                height={52}
                style={{ width: 52, height: 52, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
              />
            )}
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>
                {resolved.provisionalTitle ?? "Untitled sound"}
              </p>
              <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "4px 0 0" }}>
                {[
                  resolved.artist || null,
                  resolved.usesCount !== null ? `${resolved.usesCount.toLocaleString()} videos` : null,
                  `${resolved.platform} · sound ${resolved.soundId}`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
          </div>
          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>
            {resolved.coverImageUrl
              ? "This cover art becomes the campaign\u2019s thumbnail."
              : "The cover art could not be read, so the campaign keeps the thumbnail it has."}
          </p>
          {error && <p role="alert" style={{ fontSize: 12, color: "var(--cc-danger)", margin: 0 }}>{error}</p>}
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
          <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>
            <Check size={16} color="var(--cc-primary)" aria-hidden="true" /> Tracking this sound
          </p>
          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: 0 }}>
            Usage is read once a day, and the audio card is now on this campaign&apos;s Performance
            section and on every client report shared from it. The cover art becomes the
            campaign&apos;s thumbnail once the first reading lands.
          </p>
          <div>
            <Button variant="secondary" onClick={reset}>Done</Button>
          </div>
        </div>
      )}
    </div>
  );
}
