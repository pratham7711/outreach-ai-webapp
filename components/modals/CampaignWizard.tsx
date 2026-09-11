"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Input, Badge } from "@pratham7711/ui";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";
import { Dropdown, Button } from "@/components/ds";
import { SOUND_URL_ERRORS, parseSoundUrl } from "@/lib/trackers/soundUrl";

type Client = { id: string; name: string };

type TypeConfig =
  | { model: "fixed"; ratePerPost: number; currency: string; maxPosts?: number }
  | { model: "per_view"; ratePerThousandViews: number; capAmount: number; currency: string; trackingWindowDays: number }
  | { model: "negotiated"; baseRate?: number; currency: string; allowCounterOffer: boolean };

type PayoutModel = "fixed" | "per_view" | "negotiated";

type WizardForm = {
  // Step 1 — Basics
  title: string;
  clientId: string;
  thumbnailUrl: string;
  notes: string;
  hasAudio: boolean;
  audioUrl: string;
  // Step 2 — Payout
  payoutModel: PayoutModel;
  budget: string;
  currency: WizardCurrency;
  paymentMode: "MANAGED" | "SELF_MANAGED";
  ratePerPost: string;
  maxPosts: string;
  ratePerThousandViews: string;
  capAmount: string;
  trackingWindowDays: string;
  baseRate: string;
  allowCounterOffer: boolean;
  // Step 3 — Settings
  postApprovalMode: "MANUAL" | "AUTO_APPROVED";
  paymentRelease: "MANUAL" | "ON_POST_APPROVAL" | "ON_CREATOR_REQUEST";
  enrollmentOpen: boolean;
};

const STEPS = [
  { label: "Basics" },
  { label: "Payout" },
  { label: "Settings" },
];

/**
 * How the campaign gets paid for. This used to be asked twice: once as
 * "Campaign Type" (Budget Based / View Based) and again as "Payout Model"
 * (Fixed / Per 1K Views), in words so close they were indistinguishable --
 * and as two independent fields, so "Budget Based" + "Per 1K Views" was
 * selectable and produced a campaign whose payout calculator refuses to run,
 * because that route requires campaignType === "VIEW_BASED" while the rates
 * come from the payout model. Asking once and deriving the type removes the
 * contradiction rather than documenting it.
 */
const PAYOUT_MODELS: { value: PayoutModel; label: string; desc: string }[] = [
  { value: "fixed", label: "Fixed rate per post", desc: "A set amount for each approved post." },
  { value: "per_view", label: "Per 1K views, with a cap", desc: "Pay on performance, capped at a maximum." },
  { value: "negotiated", label: "Negotiated", desc: "Agree a rate with each creator individually." },
];

/** The stored campaignType follows from the payout choice. The two remaining
 *  enum values (OPEN_COMMUNITY, PRIVATE_INVITE) describe *access*, which the
 *  Open enrollment switch on the last step already decides -- the second place
 *  the old form asked one question twice. */
export function campaignTypeFor(model: PayoutModel): "VIEW_BASED" | "BUDGET_BASED" {
  return model === "per_view" ? "VIEW_BASED" : "BUDGET_BASED";
}

const selectStyle = {
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

const cardOptionStyle = (selected: boolean) => ({
  padding: 16,
  borderRadius: 10,
  border: `2px solid ${selected ? "var(--cc-primary)" : "var(--cc-border)"}`,
  background: selected ? "var(--cc-primary-light)" : "var(--cc-card)",
  cursor: "pointer",
  transition: "all 0.15s",
});

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
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<WizardForm>({
    title: "",
    clientId: "",
    thumbnailUrl: "",
    notes: "",
    hasAudio: false,
    audioUrl: "",
    payoutModel: "fixed",
    budget: "",
    currency: resolveCurrency(defaultCurrency),
    paymentMode: "SELF_MANAGED",
    ratePerPost: "",
    maxPosts: "",
    ratePerThousandViews: "",
    capAmount: "",
    trackingWindowDays: "7",
    baseRate: "",
    allowCounterOffer: true,
    postApprovalMode: "MANUAL",
    paymentRelease: "MANUAL",
    enrollmentOpen: false,
  });

  const set = (patch: Partial<WizardForm>) => setForm((f) => ({ ...f, ...patch }));

  /* The same parser the server runs, so the form cannot accept a link the API
     will reject -- and a post link is named as one before a request is made. */
  const audioError = useMemo(() => {
    if (!form.hasAudio) return null;
    const raw = form.audioUrl.trim();
    if (!raw) return null;
    const parsed = parseSoundUrl(raw);
    if (parsed.kind === "sound" || parsed.kind === "short-link") return null;
    const reason = parsed.kind === "video" ? "video_url" : parsed.reason;
    return SOUND_URL_ERRORS[reason] ?? SOUND_URL_ERRORS.unrecognised;
  }, [form.hasAudio, form.audioUrl]);

  const buildTypeConfig = (): TypeConfig => {
    if (form.payoutModel === "fixed") {
      return {
        model: "fixed",
        ratePerPost: Number(form.ratePerPost) || 0,
        currency: form.currency,
        ...(form.maxPosts ? { maxPosts: Number(form.maxPosts) } : {}),
      };
    }
    if (form.payoutModel === "per_view") {
      return {
        model: "per_view",
        ratePerThousandViews: Number(form.ratePerThousandViews) || 0,
        capAmount: Number(form.capAmount) || 0,
        currency: form.currency,
        trackingWindowDays: Number(form.trackingWindowDays) || 7,
      };
    }
    return {
      model: "negotiated",
      ...(form.baseRate ? { baseRate: Number(form.baseRate) } : {}),
      currency: form.currency,
      allowCounterOffer: form.allowCounterOffer,
    };
  };

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
          thumbnailUrl: form.thumbnailUrl || null,
          notes: form.notes || null,
          campaignType: campaignTypeFor(form.payoutModel),
          budget: form.budget ? Number(form.budget) : null,
          currency: form.currency,
          paymentMode: form.paymentMode,
          paymentRelease: form.paymentRelease,
          postApprovalMode: form.postApprovalMode,
          enrollmentOpen: form.enrollmentOpen,
          typeConfig: buildTypeConfig(),
          ...(form.hasAudio && form.audioUrl.trim() ? { audioUrl: form.audioUrl.trim() } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/campaigns/${data.id}`);
        router.refresh();
        onClose();
        return;
      }
      /* A rejected audio link is the likely failure and it happens on the step
         the operator has already left, so say what went wrong instead of
         closing silently -- the old form swallowed this. */
      const body = await res.json().catch(() => null);
      setError(body?.message ?? body?.error ?? "Could not create that campaign.");
      if (body?.error && SOUND_URL_ERRORS[body.error]) setStep(0);
    } finally {
      setLoading(false);
    }
  };

  /**
   * The payout step's own validation, which did not exist.
   *
   * canNext() only ever looked at step 0, so "Fixed rate per post" with the
   * rate left blank walked through to the end and buildTypeConfig()'s
   * `Number("") || 0` shipped ratePerPost: 0 -- a campaign that promises every
   * creator nothing per post, created without a word of complaint. Per-view is
   * the same shape: a zero rate pays nothing and a zero cap caps at nothing.
   *
   * It disables Create Campaign as well as Next, because by the time that
   * button is on screen the payout step is two steps behind and nothing else
   * between here and the API looks at the rate.
   */
  /**
   * The same rules, but answered per field rather than one at a time.
   *
   * These used to collapse into a single message printed after all three payout
   * blocks, which put "Enter the rate you pay per approved post." below the
   * Rate per Post box, past Max Posts, and immediately above Budget -- close
   * enough to Budget to read as a complaint about Budget. Per-view was worse:
   * two fields could be empty and only the first was ever named, so filling
   * the one it asked for produced a second identical-looking refusal.
   *
   * Input takes an `error` prop that renders the message under its own box and
   * wires aria-invalid and aria-describedby to it, so the field states its own
   * problem and a screen reader reaches it from the input.
   */
  const payoutFieldErrors = useMemo(() => {
    const positive = (v: string) => Number(v) > 0;
    return {
      ratePerPost:
        form.payoutModel === "fixed" && !positive(form.ratePerPost)
          ? "Enter the rate you pay per approved post."
          : undefined,
      ratePerThousandViews:
        form.payoutModel === "per_view" && !positive(form.ratePerThousandViews)
          ? "Enter the rate you pay per 1,000 views."
          : undefined,
      capAmount:
        form.payoutModel === "per_view" && !positive(form.capAmount)
          ? "Enter the maximum you will pay a creator."
          : undefined,
    };
    // Negotiated agrees a rate per creator later, so there is nothing to hold here.
  }, [form.payoutModel, form.ratePerPost, form.ratePerThousandViews, form.capAmount]);

  /* What holds Next and Create Campaign. Unchanged in effect -- the gate was
     already right, it was only the explaining that was in the wrong place. */
  const payoutError = useMemo(
    () => Object.values(payoutFieldErrors).some(Boolean),
    [payoutFieldErrors]
  );

  const canNext = () => {
    if (step === 0) return form.title.trim().length > 0 && !audioError;
    if (step === 1) return !payoutError;
    return true;
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="New Campaign"
      size="lg"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between", width: "100%" }}>
          <div>
            {step > 0 && (
              <Button variant="secondary" onClick={() => setStep((s) => s - 1)}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <ChevronLeft size={14} /> Back
                </span>
              </Button>
            )}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            {step < STEPS.length - 1 ? (
              <Button variant="primary" disabled={!canNext()} onClick={() => setStep((s) => s + 1)}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  Next <ChevronRight size={14} />
                </span>
              </Button>
            ) : (
              <Button variant="primary" loading={loading} disabled={payoutError} onClick={handleSubmit}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Check size={14} /> Create Campaign
                </span>
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", gap: 4, marginBottom: 24 }}>
        {STEPS.map((s, i) => (
          <div
            key={s.label}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 2,
              background: i <= step ? "var(--cc-primary)" : "var(--cc-border)",
              transition: "background 0.2s",
            }}
          />
        ))}
      </div>
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", marginBottom: 16, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Step {step + 1} of {STEPS.length} — {STEPS[step].label}
      </p>

      {error && (
        <div role="alert" style={{ fontSize: 13, color: "var(--cc-danger)", marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* ── Step 1 — Basics ─────────────────────────────────────────────── */}
      {step === 0 && (
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
                onChange={(e) => set({ hasAudio: e.target.checked, ...(e.target.checked ? {} : { audioUrl: "" }) })}
              />
              <span style={{ fontSize: 14, color: "var(--cc-text)" }}>This campaign promotes a sound</span>
            </label>
            {form.hasAudio && (
              <div style={{ marginTop: 12 }}>
                <Input
                  label="Sound link"
                  value={form.audioUrl}
                  onChange={(e) => set({ audioUrl: e.target.value })}
                  placeholder="tiktok.com/music/... or instagram.com/reels/audio/..."
                  aria-invalid={audioError !== null}
                />
                {audioError ? (
                  <p role="alert" style={{ fontSize: 12, color: "var(--cc-danger)", margin: "6px 0 0" }}>
                    {audioError}
                  </p>
                ) : (
                  <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "6px 0 0" }}>
                    We start tracking the sound&apos;s usage from here. Title and artwork fill in
                    after the first reading.
                  </p>
                )}
              </div>
            )}
          </div>

          <Input
            label="Thumbnail URL"
            value={form.thumbnailUrl}
            onChange={(e) => set({ thumbnailUrl: e.target.value })}
            placeholder="https://..."
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
        </div>
      )}

      {/* ── Step 2 — Payout ─────────────────────────────────────────────── */}
      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {PAYOUT_MODELS.map((opt) => (
              <div key={opt.value} onClick={() => set({ payoutModel: opt.value })} style={cardOptionStyle(form.payoutModel === opt.value)}>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{opt.label}</p>
                <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{opt.desc}</p>
              </div>
            ))}
          </div>

          {form.payoutModel === "fixed" && (
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <Input label="Rate per Post" type="number" required error={payoutFieldErrors.ratePerPost} value={form.ratePerPost} onChange={(e) => set({ ratePerPost: e.target.value })} placeholder="e.g. 500" />
              </div>
              <div style={{ flex: 1 }}>
                <Input label="Max Posts (optional)" type="number" value={form.maxPosts} onChange={(e) => set({ maxPosts: e.target.value })} placeholder="e.g. 3" />
              </div>
            </div>
          )}
          {form.payoutModel === "per_view" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "flex", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <Input label="Rate per 1K Views" type="number" required error={payoutFieldErrors.ratePerThousandViews} value={form.ratePerThousandViews} onChange={(e) => set({ ratePerThousandViews: e.target.value })} placeholder="e.g. 5" />
                </div>
                <div style={{ flex: 1 }}>
                  <Input label="Cap Amount" type="number" required error={payoutFieldErrors.capAmount} value={form.capAmount} onChange={(e) => set({ capAmount: e.target.value })} placeholder="e.g. 2000" />
                </div>
              </div>
              <Input label="Tracking Window (days)" type="number" value={form.trackingWindowDays} onChange={(e) => set({ trackingWindowDays: e.target.value })} placeholder="7" />
            </div>
          )}
          {form.payoutModel === "negotiated" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <Input label="Base Rate (optional)" type="number" value={form.baseRate} onChange={(e) => set({ baseRate: e.target.value })} placeholder="Suggested starting rate" />
              <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={form.allowCounterOffer} onChange={(e) => set({ allowCounterOffer: e.target.checked })} />
                <span style={{ fontSize: 14, color: "var(--cc-text)" }}>Allow creators to counter-offer</span>
              </label>
            </div>
          )}

          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <Input
                label="Budget"
                type="number"
                value={form.budget}
                onChange={(e) => set({ budget: e.target.value })}
                placeholder="e.g. 10000"
              />
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
            <label style={labelStyle}>Who handles payment?</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {[
                { value: "MANAGED" as const, label: "Managed", desc: "We hold the deposit and release payments through the platform." },
                { value: "SELF_MANAGED" as const, label: "Self-managed", desc: "Your organization pays creators directly, outside the platform." },
              ].map((opt) => (
                <div key={opt.value} onClick={() => set({ paymentMode: opt.value })} style={cardOptionStyle(form.paymentMode === opt.value)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{opt.label}</p>
                    {form.paymentMode === opt.value && <Badge variant="accent">Selected</Badge>}
                  </div>
                  <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{opt.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Step 3 — Settings ───────────────────────────────────────────── */}
      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <label style={labelStyle}>Post Approval Mode</label>
            <div style={{ display: "flex", gap: 12 }}>
              {[
                { value: "MANUAL" as const, label: "Manual Review", desc: "You approve each post before it counts" },
                { value: "AUTO_APPROVED" as const, label: "Auto-Approved", desc: "Posts are approved automatically on submission" },
              ].map((opt) => (
                <div key={opt.value} onClick={() => set({ postApprovalMode: opt.value })} style={{ ...cardOptionStyle(form.postApprovalMode === opt.value), flex: 1 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{opt.label}</p>
                  <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{opt.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Payment Release Trigger</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[
                { value: "MANUAL" as const, label: "Manual", desc: "You release payments manually" },
                { value: "ON_POST_APPROVAL" as const, label: "On Post Approval", desc: "Auto-release when a post is approved" },
                { value: "ON_CREATOR_REQUEST" as const, label: "On Creator Request", desc: "Release when creator requests payout" },
              ].map((opt) => (
                <div key={opt.value} onClick={() => set({ paymentRelease: opt.value })} style={cardOptionStyle(form.paymentRelease === opt.value)}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{opt.label}</p>
                    {form.paymentRelease === opt.value && <Badge variant="accent">Active</Badge>}
                  </div>
                  <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{opt.desc}</p>
                </div>
              ))}
            </div>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input type="checkbox" checked={form.enrollmentOpen} onChange={(e) => set({ enrollmentOpen: e.target.checked })} />
            <span style={{ fontSize: 14, color: "var(--cc-text)" }}>Open enrollment — creators can self-join this campaign</span>
          </label>
        </div>
      )}
    </Modal>
  );
}
