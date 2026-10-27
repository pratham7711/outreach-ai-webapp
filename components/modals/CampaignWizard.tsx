"use client";

import { useEffect, useRef, useState, type ChangeEvent, type ClipboardEvent, type FocusEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Modal, Input } from "@pratham7711/ui";
import { Check, Music2 } from "lucide-react";
import { toast } from "sonner";
import { Dropdown, Button } from "@/components/ds";
import { SOUND_URL_ERRORS, parseSoundUrl } from "@/lib/trackers/soundUrl";
import { ThumbnailDrop, prepareThumbnail, uploadCampaignThumbnail, type PreparedThumbnail } from "@/components/campaigns/ThumbnailDrop";
import {
  SPOTIFY_LINK_LABEL,
  SPOTIFY_LINK_PLACEHOLDER,
  SpotifyLinkStatus,
  useSpotifyLinkCheck,
  type SpotifyCheck,
} from "@/components/campaigns/SpotifyLinkCheck";
import {
  INSTAGRAM_AUDIO_LABEL,
  INSTAGRAM_AUDIO_PLACEHOLDER,
  InstagramAudioStatus,
  useInstagramAudioCheck,
  type InstagramAudioCheck,
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

type Client = { id: string; name: string };

/* Always negotiated (October 2026). The payout step is gone with the rest of
   the payments surface, and negotiated is the one model that needs no rate:
   per-view demands a rate and a cap, so defaulting to it would have left
   Create Campaign disabled with no field on screen to fix it. The API still
   takes per-view, and a campaign's Settings tab can still publish a rate. */
type TypeConfig = { model: "negotiated"; currency: string; allowCounterOffer: boolean };

/** What Import brought back off the sound's own page. Null until it is run,
 *  and cleared whenever the link is edited -- artwork belonging to the previous
 *  link is worse than none. */
type ImportedAudio = {
  soundId: string;
  platform: string;
  title: string | null;
  artist: string | null;
  coverImageUrl: string | null;
  usesCount: number | null;
};

type PostApprovalMode = "MANUAL" | "AUTO_APPROVED";

/** Which form value holds each audio field's link. */
const FIELD_KEY = { TIKTOK: "audioUrl", INSTAGRAM: "instagramAudioUrl", SPOTIFY: "spotifyUrl" } as const;

type FieldSnapshot =
  | { field: "TIKTOK"; imported: ImportedAudio | null; importError: string | null; last: string; busy: boolean }
  | { field: "INSTAGRAM"; check: InstagramAudioCheck }
  | { field: "SPOTIFY"; check: SpotifyCheck };
/** The link a paste replaced, and what had been found for it. */
type Before = { value: string; snapshot: FieldSnapshot } | null;

type WizardForm = {
  title: string;
  clientId: string;
  notes: string;
  hasAudio: boolean;
  /** The TikTok sound. */
  audioUrl: string;
  instagramAudioUrl: string;
  spotifyUrl: string;
  budget: string;
  currency: WizardCurrency;
  postApprovalMode: PostApprovalMode;
};

/* One step. It was two -- Basics, then Payout & approval -- and the second
   held the payout model and its rates, which left with the payments surface.
   Budget, currency and post approval are campaign management, not payments,
   so they moved up here rather than going with it. */

const POST_APPROVAL_MODES: { value: PostApprovalMode; label: string; desc: string }[] = [
  { value: "MANUAL", label: "Manual Review", desc: "You approve each post before it counts" },
  { value: "AUTO_APPROVED", label: "Auto-Approved", desc: "Posts are approved automatically on submission" },
];

/* Payment is always self-managed: the org pays its creators directly, outside
   the platform. We do not hold deposits or release payments, so asking the
   question offered a service that does not exist. The column keeps its schema
   default (SELF_MANAGED) and this form no longer sends it. */

const selectStyle = {
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

const cardOptionStyle = (selected: boolean) => ({
  padding: 16,
  borderRadius: 10,
  border: `2px solid ${selected ? "var(--cc-primary)" : "var(--cc-border)"}`,
  background: selected ? "var(--cc-primary-light)" : "var(--cc-card)",
  cursor: "pointer",
  transition: "all 0.15s",
});

/** The option cards are a radio group, not a stack of divs. Measured on prod:
 *  role null, tabIndex -1, no aria-checked -- so eighteen Tab presses on the
 *  payout step never reach one, and the model can only be changed with a
 *  mouse. Roving tabindex per the APG radiogroup pattern: the group is a single
 *  tab stop and the arrow keys move within it. The tab stop falls back to the
 *  first card when nothing matches, so the group can never become unreachable. */
function CardRadioGroup<T extends string>({
  label,
  value,
  options,
  onChange,
  renderBody,
  row = false,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string; desc: string }[];
  onChange: (next: T) => void;
  renderBody?: (opt: { value: T; label: string; desc: string }, selected: boolean) => ReactNode;
  /** Side by side, each card an equal share of the row. */
  row?: boolean;
}) {
  const cards = useRef<(HTMLDivElement | null)[]>([]);
  const selectedIndex = options.findIndex((o) => o.value === value);
  const tabStop = selectedIndex === -1 ? 0 : selectedIndex;

  const step = (from: number, delta: number) => {
    const to = (from + delta + options.length) % options.length;
    onChange(options[to].value);
    cards.current[to]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} style={{ display: "flex", flexDirection: row ? "row" : "column", gap: 12 }}>
      {options.map((opt, i) => {
        const selected = opt.value === value;
        return (
          <div
            key={opt.value}
            ref={(el) => {
              cards.current[i] = el;
            }}
            role="radio"
            aria-checked={selected}
            tabIndex={i === tabStop ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onChange(opt.value);
              } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                e.preventDefault();
                step(i, 1);
              } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                e.preventDefault();
                step(i, -1);
              }
            }}
            style={{ ...cardOptionStyle(selected), ...(row ? { flex: 1 } : {}) }}
          >
            {renderBody ? (
              renderBody(opt, selected)
            ) : (
              <>
                <p style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{opt.label}</p>
                <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>{opt.desc}</p>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

const CURRENCIES = ["USD", "EUR", "GBP", "INR"] as const;
type WizardCurrency = (typeof CURRENCIES)[number];

/** The org's own currency, or USD when it is missing or something we cannot
 *  offer. Same narrowing the self-serve wizard does with its defaultCurrency. */
function resolveCurrency(value: string | undefined | null): WizardCurrency {
  return (CURRENCIES as readonly string[]).includes(value ?? "")
    ? (value as WizardCurrency)
    : "USD";
}

export default function CampaignWizard({
  clients,
  defaultCurrency,
  onClose,
}: {
  clients: Client[];
  /* Organization.currency. Hardcoding USD here meant an agency that bills in
     INR got a USD campaign every time and had to change it on the last step,
     for every campaign -- and the budget chip on the list reads whatever was
     stored. app/(dashboard)/campaigns/self-serve/page.tsx already reads it. */
  defaultCurrency?: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [imported, setImported] = useState<ImportedAudio | null>(null);
  /* A picture chosen for the campaign. Saved once the campaign exists, and
     then it, not the sound's cover, is what the campaign shows. */
  const [picture, setPicture] = useState<PreparedThumbnail | null>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [preparingPicture, setPreparingPicture] = useState(false);
  const [form, setForm] = useState<WizardForm>({
    title: "",
    clientId: "",
    notes: "",
    hasAudio: false,
    audioUrl: "",
    instagramAudioUrl: "",
    spotifyUrl: "",
    budget: "",
    currency: resolveCurrency(defaultCurrency),
    postApprovalMode: "MANUAL",
  });

  const set = (patch: Partial<WizardForm>) => setForm((f) => ({ ...f, ...patch }));

  const preview = picture?.preview ?? null;
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  const pickPicture = async (file: File) => {
    setPreparingPicture(true);
    setPictureError(null);
    const prepared = await prepareThumbnail(file);
    setPreparingPicture(false);
    if (!prepared.ok) {
      setPictureError(prepared.error);
      return;
    }
    setPicture(prepared.picture);
  };

  /* The three links, placed and checked the moment one is pasted or a field
     is left (lib/campaigns/audioLinkField). A link goes to the field its site
     belongs to, whichever field it was pasted into, and is checked there: the
     TikTok sound and the Instagram audio against their own pages, which hand
     back the cover, title and usage shown under the field; the Spotify link
     against Spotify. A link that can never give a number to follow -- a post,
     original audio, an album -- is left out with a line saying why, so nothing
     here holds Create back. A platform that did not answer keeps the link: the
     server checks it again on create. */
  const instagram = useInstagramAudioCheck();
  const spotify = useSpotifyLinkCheck();
  const { run: runInstagram, edited: instagramEdited, restore: restoreInstagram } = instagram;
  const { run: runSpotify, edited: spotifyEdited, restore: restoreSpotify } = spotify;
  const [notices, setNotices] = useState<Partial<Record<AudioField, AudioFieldNoticeValue>>>({});
  const setNotice = (field: AudioField, notice: AudioFieldNoticeValue | null) =>
    setNotices((n) => ({ ...n, [field]: notice ?? undefined }));

  const instagramFound = instagram.check.status === "found" && instagram.check.raw === form.instagramAudioUrl.trim()
    ? instagram.check.audio
    : null;

  /* The newest TikTok check wins, as in the two hooks. */
  const tiktokSeq = useRef(0);
  const tiktokLast = useRef("");

  /* Whatever was checked for a field described a link that is no longer in it. */
  const forgetCheck = (field: AudioField) => {
    if (field === "TIKTOK") {
      tiktokLast.current = "";
      tiktokSeq.current++;
      setImported(null);
      setImportError(null);
      setImporting(false);
    } else if (field === "INSTAGRAM") {
      instagramEdited("");
    } else {
      spotifyEdited("");
    }
  };

  /* What a field showed for its link, kept when a paste replaces it so that
     the link can be put back as it was if the paste is left out. */
  const snapshotOf = (field: AudioField): FieldSnapshot =>
    field === "TIKTOK"
      ? { field, imported, importError, last: tiktokLast.current, busy: importing }
      : field === "INSTAGRAM"
        ? { field, check: instagram.check }
        : { field, check: spotify.check };

  const putBack = (field: AudioField, before: Before) => {
    if (!before) {
      forgetCheck(field);
      return;
    }
    const snap = before.snapshot;
    const settled =
      snap.field === "TIKTOK"
        ? !snap.busy && snap.last === before.value
        : snap.check.status !== "checking" && snap.check.status !== "idle" && snap.check.raw === before.value;
    if (!settled) {
      forgetCheck(field);
      void checkField(field, before.value, null);
    } else if (snap.field === "TIKTOK") {
      tiktokSeq.current++;
      tiktokLast.current = snap.last;
      setImported(snap.imported);
      setImportError(snap.importError);
      setImporting(false);
    } else if (snap.field === "INSTAGRAM") {
      restoreInstagram(snap.check);
    } else {
      restoreSpotify(snap.check);
    }
  };

  /* Left out: the field goes back to what it held before -- empty, or the
     link a paste tried to replace, with what was found for it. */
  const leaveOut = (field: AudioField, reason: string | null | undefined, message: string, before: Before = null) => {
    setForm((f) => ({ ...f, [FIELD_KEY[field]]: before?.value ?? "" }));
    putBack(field, before);
    setNotice(field, droppedNotice(reason, message, before !== null));
  };

  /* The TikTok sound's own page: its cover becomes Campaign.thumbnailUrl on
     submit, which is what the campaigns list draws instead of the title's
     initials. One read per distinct link, on paste or when the field is left;
     it used to wait for an Import button. */
  const checkTikTok = async (raw: string, before: Before) => {
    if (raw === tiktokLast.current) return;
    tiktokLast.current = raw;
    const n = ++tiktokSeq.current;
    setImported(null);
    setImportError(null);
    const parsed = parseSoundUrl(raw);
    if (parsed.kind !== "sound" && parsed.kind !== "short-link") {
      const reason = parsed.kind === "video" ? "video_url" : parsed.reason;
      leaveOut("TIKTOK", reason, SOUND_URL_ERRORS[reason] ?? SOUND_URL_ERRORS.unrecognised, before);
      return;
    }
    setImporting(true);
    try {
      const res = await fetch("/api/campaigns/audio/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: raw }),
      });
      const body = await res.json().catch(() => null);
      if (n !== tiktokSeq.current) return;
      if (!res.ok) {
        const message = body?.message ?? "Could not read that sound.";
        if (res.status === 400 && isLastingRefusal(body?.error)) leaveOut("TIKTOK", body?.error, message, before);
        else setImportError(message);
        return;
      }
      /* The link parsed, but TikTok had no sound under that id -- or would not
         say. Either way nothing was found, so no card and no name: the slug in
         the URL is not the sound's title. The link is still kept: creating
         the campaign primes a read of the sound, and the daily sound snapshot
         keeps trying, so the details fill in if it turns out to be real. */
      if (body?.verified === false) {
        setImportError(
          "We couldn't find or verify this sound on TikTok. Check the link; if it is right, you can still create the campaign and the sound's details fill in once TikTok answers.",
        );
        return;
      }
      setImported({
        soundId: body.soundId,
        platform: body.platform,
        title: body.provisionalTitle ?? null,
        artist: body.artist ?? null,
        coverImageUrl: body.coverImageUrl ?? null,
        usesCount: typeof body.usesCount === "number" ? body.usesCount : null,
      });
      /* The link resolved but the page would not answer. Said out loud, because
         a resolved sound with no cover otherwise looks identical to one that
         was never read. */
      if (!body.coverImageUrl) {
        setImportError("Found the sound, but its cover art could not be read — the campaign will use its initials.");
      }
    } catch {
      if (n === tiktokSeq.current) setImportError("Could not reach the server.");
    } finally {
      if (n === tiktokSeq.current) setImporting(false);
    }
  };

  /* `before` is what the field held before this link, put back if it is left out. */
  const checkField = async (field: AudioField, raw: string, before: Before) => {
    if (field === "TIKTOK") return checkTikTok(raw, before);
    const result = field === "INSTAGRAM" ? await runInstagram(raw) : await runSpotify(raw);
    if (result?.status === "refused") leaveOut(field, result.reason, result.message, before);
  };

  /* A paste is handled here rather than left to the input, which would drop
     the link in at the caret -- beside whatever link the field already held.
     A field holds one link, so the pasted one takes the whole of its own
     field, and the field it was pasted into keeps what it had when the link
     belongs elsewhere. Text that is not a link is pasted as usual. */
  const pasted = (into: AudioField, e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text").trim();
    if (!isLinkLike(text)) return;
    e.preventDefault();
    const to = audioFieldFor(text);
    if (to === null) {
      setNotice(into, droppedNotice("not_tiktok", SOUND_URL_ERRORS.not_tiktok, form[FIELD_KEY[into]].trim() !== ""));
      return;
    }
    const previous = form[FIELD_KEY[to]].trim();
    if (previous === text) return;
    const before: Before = previous ? { value: previous, snapshot: snapshotOf(to) } : null;
    setForm((f) => ({ ...f, [FIELD_KEY[to]]: text }));
    if (to !== into) setNotice(into, null);
    setNotice(to, to === into ? null : movedNotice(into, previous !== ""));
    void checkField(to, text, before);
  };

  /* Leaving a field: a typed link is put where it belongs, then checked. */
  const place = (from: AudioField, value: string) => {
    const raw = value.trim();
    if (!raw) return;
    const to = audioFieldFor(raw);
    if (to === null) {
      leaveOut(from, "not_tiktok", SOUND_URL_ERRORS.not_tiktok);
      return;
    }
    if (to !== from) {
      const replaced = form[FIELD_KEY[to]].trim() !== "" && form[FIELD_KEY[to]].trim() !== raw;
      setForm((f) => ({ ...f, [FIELD_KEY[from]]: "", [FIELD_KEY[to]]: raw }));
      forgetCheck(from);
      setNotice(from, null);
      setNotice(to, movedNotice(from, replaced));
    }
    void checkField(to, raw, null);
  };

  /* Typing in a field: whatever was said about it described the old text. */
  const typed = (field: AudioField, value: string) => {
    setForm((f) => ({ ...f, [FIELD_KEY[field]]: value }));
    setNotice(field, null);
    if (field === "TIKTOK") {
      if (value.trim() !== tiktokLast.current) forgetCheck("TIKTOK");
    } else if (field === "INSTAGRAM") {
      instagramEdited(value);
    } else {
      spotifyEdited(value);
    }
  };

  const fieldProps = (field: AudioField) => ({
    value: form[FIELD_KEY[field]],
    onChange: (e: ChangeEvent<HTMLInputElement>) => typed(field, e.target.value),
    onPaste: (e: ClipboardEvent<HTMLInputElement>) => pasted(field, e),
    onBlur: (e: FocusEvent<HTMLInputElement>) => place(field, e.target.value),
  });

  /* No rate: a negotiated campaign's number is agreed with each creator.
     allowCounterOffer keeps the old form's default. */
  const buildTypeConfig = (): TypeConfig => ({
    model: "negotiated",
    currency: form.currency,
    allowCounterOffer: true,
  });

  /* The cover the campaign takes when no picture was chosen: the TikTok
     sound's, else the Instagram audio's. */
  const thumbnailFromAudio = imported?.coverImageUrl ?? instagramFound?.coverImageUrl ?? null;

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          clientId: form.clientId || null,
          notes: form.notes || null,
          /* BUDGET_BASED is what a negotiated campaign has always been stored
             as; VIEW_BASED belonged to per-view. */
          campaignType: "BUDGET_BASED",
          // 0 is "no budget", stored as null like an empty field.
          budget: budgetValue ? budgetValue : null,
          currency: form.currency,
          postApprovalMode: form.postApprovalMode,
          /* paymentMode, paymentRelease and enrollmentOpen are not sent -- the
             columns keep their schema defaults (SELF_MANAGED, MANUAL, false).
             thumbnailUrl is sent only when Import actually found a cover: the
             field is no longer a URL anybody types, it is the artwork of the
             sound this campaign promotes. */
          typeConfig: buildTypeConfig(),
          ...(form.hasAudio && form.audioUrl.trim() ? { audioUrl: form.audioUrl.trim() } : {}),
          ...(form.hasAudio && form.instagramAudioUrl.trim() ? { instagramAudioUrl: form.instagramAudioUrl.trim() } : {}),
          ...(form.hasAudio && form.spotifyUrl.trim() ? { spotifyUrl: form.spotifyUrl.trim() } : {}),
          /* Not when a picture was chosen: it is saved next, and a cover
             sent here would be downloaded in the background and could land
             after it. */
          ...(form.hasAudio && thumbnailFromAudio && !picture ? { thumbnailUrl: thumbnailFromAudio } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        /* The campaign exists either way; only the link was not kept (the
           database cannot store one yet). Said, not swallowed, like the
           picture below. */
        if (data.spotifyLinked === false) {
          toast.error("Campaign created, but the Spotify link didn't save. Add it from the campaign's audio settings.");
        }
        if (data.instagramLinked === false) {
          toast.error("Campaign created, but the Instagram audio didn't save beside the TikTok sound. Add it from the campaign's audio settings.");
        }
        if (picture) {
          const saved = await uploadCampaignThumbnail(data.id, picture);
          if (!saved.ok) {
            toast.error(`Campaign created, but the picture didn't save: ${saved.error} Add it from the campaign's Edit tab.`);
          }
        }
        router.push(`/campaigns/${data.id}`);
        router.refresh();
        onClose();
        return;
      }
      /* A rejected audio link is the likely failure, so say what went wrong
         instead of closing silently -- the old form swallowed this. */
      const body = await res.json().catch(() => null);
      setError(body?.message ?? body?.error ?? "Could not create that campaign.");
    } finally {
      setLoading(false);
    }
  };

  /* A budget is money set aside, so it cannot be negative. The number input
     took "-500" and the server's refusal came back as a bare "Invalid input";
     it is caught here, beside the field, before anything is sent. The route
     refuses it too (app/api/campaigns). */
  const budgetValue = form.budget.trim() === "" ? null : Number(form.budget);
  const budgetError =
    budgetValue !== null && (!Number.isFinite(budgetValue) || budgetValue < 0) ? "Budget can't be negative." : null;

  /* Held only while a link is being checked: its answer may still leave it
     out, and a campaign created a moment earlier would have sent it. */
  const checkingLink =
    form.hasAudio && (importing || instagram.check.status === "checking" || spotify.check.status === "checking");

  const canCreate =
    form.title.trim().length > 0 &&
    !checkingLink &&
    !budgetError &&
    !preparingPicture;

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="New Campaign"
      size="lg"
      footer={
        <div className="cc-modal-footer" data-layout="split">
          <div />
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={loading} disabled={!canCreate} onClick={handleSubmit}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <Check size={14} /> Create Campaign
              </span>
            </Button>
          </div>
        </div>
      }
    >
      {error && (
        <div role="alert" style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-danger)", marginBottom: 16 }}>
          {error}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Input
          label="Campaign Name"
          value={form.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder="e.g. Summer Drop 2026"
          required
        />
        <div>
          <label htmlFor="wz-client" style={labelStyle}>Client</label>
          <Dropdown
            ariaLabel="Client"
            align="left"
            fullWidth
            value={form.clientId}
            onChange={(v) => set({ clientId: v })}
            options={[
              { value: "", label: "No client" },
              ...clients.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>

        {/* Audio is asked here rather than in a later step because it is a
            fact about the campaign, known when it is set up, not a payment
            decision. Off by default: brand work has no sound behind it. */}
        <div>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={form.hasAudio}
              onChange={(e) => {
                set({
                  hasAudio: e.target.checked,
                  ...(e.target.checked ? {} : { audioUrl: "", instagramAudioUrl: "", spotifyUrl: "" }),
                });
                if (!e.target.checked) {
                  forgetCheck("TIKTOK");
                  forgetCheck("INSTAGRAM");
                  forgetCheck("SPOTIFY");
                  setNotices({});
                }
              }}
            />
            <span style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text)" }}>This campaign promotes a sound</span>
          </label>
          {form.hasAudio && (
            <div style={{ marginTop: 12 }}>
              <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "0 0 10px" }}>
                Paste the song&apos;s links. Each one goes to its own field, whichever box you paste it in.
              </p>
              <Input
                label="TikTok sound"
                {...fieldProps("TIKTOK")}
                placeholder="https://www.tiktok.com/music/…"
                inputMode="url"
                autoComplete="off"
              />

              {imported && (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    marginTop: 10,
                    padding: 10,
                    borderRadius: 10,
                    border: "1px solid var(--cc-border)",
                    background: "var(--cc-card)",
                  }}
                >
                  {imported.coverImageUrl ? (
                    /* eslint-disable-next-line @next/next/no-img-element --
                       a signed TikTok CDN URL on a host next/image is not
                       configured for. */
                    <img
                      src={imported.coverImageUrl}
                      alt=""
                      width={48}
                      height={48}
                      style={{ width: 48, height: 48, borderRadius: 8, objectFit: "cover", flexShrink: 0 }}
                    />
                  ) : (
                    <div
                      style={{
                        width: 48, height: 48, borderRadius: 8, flexShrink: 0,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: "var(--cc-bg)", color: "var(--cc-text-muted)",
                      }}
                    >
                      <Music2 size={18} />
                    </div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {imported.title ?? `Sound ${imported.soundId}`}
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>
                      {[
                        imported.artist || null,
                        imported.usesCount !== null ? `${imported.usesCount.toLocaleString()} videos` : null,
                        imported.coverImageUrl
                          ? picture
                            ? "Your picture is used instead of this cover"
                            : "Cover art will be the campaign thumbnail"
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                </div>
              )}

              {notices.TIKTOK && <AudioFieldNotice notice={notices.TIKTOK} />}
              {notices.TIKTOK?.tone === "dropped" && !form.audioUrl.trim() ? null : (
                <>
                  {importError ? (
                    <p role="alert" style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-danger)", margin: "6px 0 0" }}>
                      {importError}
                      {/* TikTok sometimes does not answer one read and does the
                          next, so asking again is offered rather than left to
                          a retyped link. */}
                      {!imported && form.audioUrl.trim() && (
                        <>
                          {" "}
                          <button
                            type="button"
                            onClick={() => {
                              tiktokLast.current = "";
                              void checkTikTok(form.audioUrl.trim(), null);
                            }}
                            style={{
                              border: "none", background: "none", padding: 0, cursor: "pointer",
                              font: "inherit", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-primary)",
                              textDecoration: "underline",
                            }}
                          >
                            Check again
                          </button>
                        </>
                      )}
                    </p>
                  ) : importing ? (
                    <p role="status" style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "6px 0 0" }}>
                      Checking the sound with TikTok…
                    </p>
                  ) : !imported ? (
                    <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", margin: "6px 0 0" }}>
                      We read how many videos use the sound once a day. Its cover art becomes the campaign
                      thumbnail.
                    </p>
                  ) : null}
                </>
              )}

              <div style={{ marginTop: 16, minWidth: 0 }}>
                <Input
                  label={INSTAGRAM_AUDIO_LABEL}
                  {...fieldProps("INSTAGRAM")}
                  placeholder={INSTAGRAM_AUDIO_PLACEHOLDER}
                  inputMode="url"
                  autoComplete="off"
                />
                {notices.INSTAGRAM && <AudioFieldNotice notice={notices.INSTAGRAM} />}
                {notices.INSTAGRAM?.tone === "dropped" && !form.instagramAudioUrl.trim() ? null : (
                  <>
                    <InstagramAudioStatus
                      check={instagram.check}
                      localError={null}
                      note={
                        instagramFound?.coverImageUrl && !imported?.coverImageUrl
                          ? picture
                            ? "Your picture is used instead of this cover"
                            : "Cover art will be the campaign thumbnail"
                          : null
                      }
                    />
                  </>
                )}
              </div>

              <div style={{ marginTop: 16, minWidth: 0 }}>
                <Input
                  label={SPOTIFY_LINK_LABEL}
                  {...fieldProps("SPOTIFY")}
                  placeholder={SPOTIFY_LINK_PLACEHOLDER}
                  inputMode="url"
                  autoComplete="off"
                />
                {notices.SPOTIFY && <AudioFieldNotice notice={notices.SPOTIFY} />}
                {notices.SPOTIFY?.tone === "dropped" && !form.spotifyUrl.trim() ? null : (
                  <SpotifyLinkStatus check={spotify.check} localError={null} />
                )}
              </div>
            </div>
          )}
        </div>

        <ThumbnailDrop
          hint={
            form.hasAudio
              ? "Optional. Any picture: JPG, PNG, HEIC, SVG and more. Leave it empty to use the sound's cover art."
              : "Optional. Any picture: JPG, PNG, HEIC, SVG and more. Shown on the campaigns list and on client links."
          }
          preview={preview}
          caption={
            picture
              ? `${picture.name}. Shown on the campaigns list and on client links${form.hasAudio ? ", instead of the sound's cover" : ""}.`
              : undefined
          }
          busy={preparingPicture}
          error={pictureError}
          onFile={pickPicture}
          onRemove={() => {
            setPicture(null);
            setPictureError(null);
          }}
        />

        <div>
          <label htmlFor="wz-notes" style={labelStyle}>Notes</label>
          <textarea
            id="wz-notes"
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="Internal notes about this campaign..."
            rows={3}
            style={{ ...selectStyle, resize: "vertical" as const }}
          />
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Input
              label="Budget"
              type="number"
              min={0}
              value={form.budget}
              onChange={(e) => set({ budget: e.target.value })}
              placeholder="e.g. 10000"
              aria-invalid={Boolean(budgetError)}
            />
            {budgetError && (
              <p role="alert" style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-danger)", margin: "6px 0 0" }}>
                {budgetError}
              </p>
            )}
          </div>
          <div style={{ width: 110 }}>
            <label htmlFor="wz-currency" style={labelStyle}>Currency</label>
            <Dropdown
              ariaLabel="Currency"
              align="left"
              fullWidth
              value={form.currency}
              onChange={(v) => set({ currency: v as WizardForm["currency"] })}
              options={CURRENCIES.map((c) => ({ value: c, label: c }))}
            />
          </div>
        </div>

        <div>
          <p style={labelStyle}>Post Approval Mode</p>
          <CardRadioGroup
            label="Post approval mode"
            row
            value={form.postApprovalMode}
            options={POST_APPROVAL_MODES}
            onChange={(postApprovalMode) => set({ postApprovalMode })}
          />
        </div>
      </div>
    </Modal>
  );
}
