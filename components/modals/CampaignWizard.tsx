"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Button, Input, Badge } from "@pratham7711/ui";
import { ChevronLeft, ChevronRight, Check } from "lucide-react";

type Client = { id: string; name: string };

type TypeConfig =
  | { model: "fixed"; ratePerPost: number; currency: string; maxPosts?: number }
  | { model: "per_view"; ratePerThousandViews: number; capAmount: number; currency: string; trackingWindowDays: number }
  | { model: "negotiated"; baseRate?: number; currency: string; allowCounterOffer: boolean };

type WizardForm = {
  // Step 1 — Basic info
  title: string;
  clientId: string;
  thumbnailUrl: string;
  notes: string;
  // Step 2 — Campaign type
  campaignType: "BUDGET_BASED" | "VIEW_BASED" | "OPEN_COMMUNITY" | "PRIVATE_INVITE";
  budget: string;
  currency: "USD" | "EUR" | "GBP" | "INR";
  // Step 3 — Payment mode
  paymentMode: "MANAGED" | "SELF_MANAGED";
  // Step 4 — Payout model
  payoutModel: "fixed" | "per_view" | "negotiated";
  ratePerPost: string;
  maxPosts: string;
  ratePerThousandViews: string;
  capAmount: string;
  trackingWindowDays: string;
  baseRate: string;
  allowCounterOffer: boolean;
  // Step 5 — Settings
  postApprovalMode: "MANUAL" | "AUTO_APPROVED";
  paymentRelease: "MANUAL" | "ON_POST_APPROVAL" | "ON_CREATOR_REQUEST";
  enrollmentOpen: boolean;
};

const STEPS = [
  { label: "Basic Info", icon: "1" },
  { label: "Campaign Type", icon: "2" },
  { label: "Payment Mode", icon: "3" },
  { label: "Payout Model", icon: "4" },
  { label: "Settings", icon: "5" },
];

const CAMPAIGN_TYPES = [
  { value: "BUDGET_BASED", label: "Budget Based", desc: "Fixed budget allocated to creators" },
  { value: "VIEW_BASED", label: "View Based", desc: "Pay based on post performance" },
  { value: "OPEN_COMMUNITY", label: "Open Community", desc: "Any creator can join and participate" },
  { value: "PRIVATE_INVITE", label: "Private Invite", desc: "Invite-only campaign for select creators" },
] as const;

const selectStyle = {
  width: "100%",
  padding: "10px 14px",
  borderRadius: 10,
  border: "1px solid var(--cc-border)",
  fontSize: 14,
  color: "var(--cc-text)",
  outline: "none",
  background: "white",
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
  background: selected ? "rgba(91, 91, 214, 0.04)" : "white",
  cursor: "pointer",
  transition: "all 0.15s",
});

export default function CampaignWizard({ clients, onClose }: { clients: Client[]; onClose: () => void }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<WizardForm>({
    title: "",
    clientId: "",
    thumbnailUrl: "",
    notes: "",
    campaignType: "BUDGET_BASED",
    budget: "",
    currency: "USD",
    paymentMode: "SELF_MANAGED",
    payoutModel: "fixed",
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
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          clientId: form.clientId || null,
          thumbnailUrl: form.thumbnailUrl || null,
          notes: form.notes || null,
          campaignType: form.campaignType,
          budget: form.budget ? Number(form.budget) : null,
          currency: form.currency,
          paymentMode: form.paymentMode,
          paymentRelease: form.paymentRelease,
          postApprovalMode: form.postApprovalMode,
          enrollmentOpen: form.enrollmentOpen,
          typeConfig: buildTypeConfig(),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/campaigns/${data.id}`);
        router.refresh();
        onClose();
      }
    } finally {
      setLoading(false);
    }
  };

  const canNext = () => {
    if (step === 0) return form.title.trim().length > 0;
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
              <Button variant="primary" loading={loading} onClick={handleSubmit}>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <Check size={14} /> Create Campaign
                </span>
              </Button>
            )}
          </div>
        </div>
      }
    >
      {/* Step indicator */}
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

      {/* Step 1 — Basic Info */}
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
            <select id="wz-client" value={form.clientId} onChange={(e) => set({ clientId: e.target.value })} style={selectStyle}>
              <option value="">No client</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
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

      {/* Step 2 — Campaign Type */}
      {step === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {CAMPAIGN_TYPES.map((ct) => (
              <div
                key={ct.value}
                onClick={() => set({ campaignType: ct.value })}
                style={cardOptionStyle(form.campaignType === ct.value)}
              >
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", marginBottom: 4 }}>{ct.label}</p>
                <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{ct.desc}</p>
              </div>
            ))}
          </div>
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
              <select id="wz-currency" value={form.currency} onChange={(e) => set({ currency: e.target.value as WizardForm["currency"] })} style={selectStyle}>
                <option>USD</option>
                <option>EUR</option>
                <option>GBP</option>
                <option>INR</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — Payment Mode */}
      {step === 2 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 8 }}>
            How will creator payments be handled for this campaign?
          </p>
          {[
            { value: "MANAGED" as const, label: "Managed", desc: "We hold the deposit and release payments to creators through the platform." },
            { value: "SELF_MANAGED" as const, label: "Self-managed", desc: "Your organization tracks and pays creators directly outside the platform." },
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
      )}

      {/* Step 4 — Payout Model */}
      {step === 3 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {[
              { value: "fixed" as const, label: "Fixed Rate per Post", desc: "Pay a set amount per approved post" },
              { value: "per_view" as const, label: "Per 1K Views (with cap)", desc: "Pay based on post performance, capped at a maximum" },
              { value: "negotiated" as const, label: "Negotiated", desc: "Negotiate rates individually with each creator" },
            ].map((opt) => (
              <div key={opt.value} onClick={() => set({ payoutModel: opt.value })} style={cardOptionStyle(form.payoutModel === opt.value)}>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{opt.label}</p>
                <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{opt.desc}</p>
              </div>
            ))}
          </div>

          {/* Config fields per model */}
          {form.payoutModel === "fixed" && (
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <Input label="Rate per Post" type="number" value={form.ratePerPost} onChange={(e) => set({ ratePerPost: e.target.value })} placeholder="e.g. 500" />
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
                  <Input label="Rate per 1K Views" type="number" value={form.ratePerThousandViews} onChange={(e) => set({ ratePerThousandViews: e.target.value })} placeholder="e.g. 5" />
                </div>
                <div style={{ flex: 1 }}>
                  <Input label="Cap Amount" type="number" value={form.capAmount} onChange={(e) => set({ capAmount: e.target.value })} placeholder="e.g. 2000" />
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
        </div>
      )}

      {/* Step 5 — Settings */}
      {step === 4 && (
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
