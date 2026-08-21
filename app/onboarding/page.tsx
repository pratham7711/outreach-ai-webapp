"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, Zap, Plus, X, ArrowRight, Check } from "lucide-react";
import { Button, Input } from "@pratham7711/ui";
import { apiPatch, apiPost } from "@/lib/api/client";
import { errorMessage } from "@/lib/api/errorMessage";
import { BRAND } from "@/lib/brand";

type OrgType = "AGENCY" | "BRAND";

const ORG_TYPES: { type: OrgType; icon: typeof Building2; label: string; description: string }[] = [
  {
    type: "AGENCY",
    icon: Building2,
    label: "Agency or label",
    description: "You run campaigns on behalf of clients.",
  },
  {
    type: "BRAND",
    icon: Zap,
    label: "Brand",
    description: "You run campaigns for your own brand.",
  },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const slide = {
  enter: { x: 32, opacity: 0 },
  center: { x: 0, opacity: 1 },
  exit: { x: -32, opacity: 0 },
};

const label: React.CSSProperties = {
  display: "block",
  fontSize: 13,
  fontWeight: 600,
  color: "var(--cc-text)",
  marginBottom: 6,
};

const stepLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: 1,
  textTransform: "uppercase",
  color: "var(--cc-text-muted)",
  marginBottom: 12,
};

function Notice({ tone, children }: { tone: "error" | "info"; children: React.ReactNode }) {
  const error = tone === "error";
  return (
    <p
      role={error ? "alert" : "status"}
      style={{
        fontSize: 13,
        lineHeight: 1.5,
        color: error ? "#DC2626" : "var(--cc-text-muted)",
        background: error ? "#FEE2E2" : "var(--cc-bg)",
        border: `1px solid ${error ? "#FECACA" : "var(--cc-border)"}`,
        borderRadius: 8,
        padding: "10px 12px",
        marginBottom: 16,
      }}
    >
      {children}
    </p>
  );
}

export default function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [orgName, setOrgName] = useState("");
  const [orgType, setOrgType] = useState<OrgType | null>(null);
  const [teammates, setTeammates] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [inviteNote, setInviteNote] = useState("");

  const totalSteps = 3;
  const progress = ((step + 1) / totalSteps) * 100;

  const saveOrg = async () => {
    if (!orgName.trim() || !orgType) return;
    setSaving(true);
    setError("");
    try {
      await apiPatch("/api/org", { name: orgName.trim(), orgType });
      setStep(1);
    } catch (err) {
      setError(errorMessage(err, "Could not save your workspace. Try again."));
    } finally {
      setSaving(false);
    }
  };

  const addTeammate = () => {
    const email = newEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      setError("That does not look like an email address.");
      return;
    }
    if (teammates.includes(email)) {
      setError("You already added that address.");
      return;
    }
    setError("");
    setTeammates([...teammates, email]);
    setNewEmail("");
  };

  const sendInvites = async () => {
    if (teammates.length === 0) {
      setStep(2);
      return;
    }
    setSaving(true);
    setError("");

    const results = await Promise.allSettled(
      teammates.map((email) => apiPost("/api/invites", { email, role: "MEMBER" })),
    );
    const failed = results.filter((r) => r.status === "rejected").length;

    setSaving(false);
    if (failed === teammates.length) {
      setError(
        errorMessage(
          (results[0] as PromiseRejectedResult).reason,
          "None of the invites went out. Try again, or invite from Settings later.",
        ),
      );
      return;
    }
    setInviteNote(
      failed === 0
        ? `${teammates.length} invite${teammates.length === 1 ? "" : "s"} sent.`
        : `${teammates.length - failed} of ${teammates.length} invites sent. Send the rest from Settings → Team.`,
    );
    setStep(2);
  };

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "40px 16px",
        background: "var(--cc-bg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <span style={{ fontWeight: 800, fontSize: 20, color: "var(--cc-text)", letterSpacing: "-0.02em" }}>
            {BRAND.name}
          </span>
        </div>

        <div
          style={{
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            borderRadius: 20,
            boxShadow: "var(--ui-shadow-lg)",
            padding: 32,
          }}
        >
          <div
            style={{ height: 3, borderRadius: 999, background: "var(--cc-bg)", marginBottom: 24 }}
            role="presentation"
          >
            <motion.div
              style={{ height: "100%", borderRadius: 999, background: "var(--cc-primary)" }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4 }}
            />
          </div>

          <AnimatePresence mode="wait">
            {step === 0 && (
              <motion.div key="step0" variants={slide} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
                <p style={stepLabel}>Step 1 of 3</p>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
                  Name your workspace
                </h1>
                <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24 }}>
                  This is what your team and your creators will see.
                </p>

                {error && <Notice tone="error">{error}</Notice>}

                <div style={{ marginBottom: 20 }}>
                  <label htmlFor="orgName" style={label}>
                    Organization name
                  </label>
                  <Input
                    id="orgName"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    placeholder="Your agency name"
                    onKeyDown={(e) => e.key === "Enter" && saveOrg()}
                  />
                </div>

                <div style={{ marginBottom: 24 }}>
                  <span style={label}>Which one are you?</span>
                  <div style={{ display: "grid", gap: 8 }}>
                    {ORG_TYPES.map(({ type, icon: Icon, label: name, description }) => {
                      const selected = orgType === type;
                      return (
                        <button
                          key={type}
                          type="button"
                          onClick={() => setOrgType(type)}
                          aria-pressed={selected}
                          style={{
                            display: "flex",
                            alignItems: "flex-start",
                            gap: 12,
                            textAlign: "left",
                            padding: 14,
                            borderRadius: 10,
                            cursor: "pointer",
                            background: selected ? "var(--cc-bg)" : "var(--cc-card)",
                            border: `1.5px solid ${selected ? "var(--cc-primary)" : "var(--cc-border)"}`,
                          }}
                        >
                          <Icon size={18} color={selected ? "var(--cc-primary)" : "var(--cc-text-muted)"} />
                          <span>
                            <span style={{ display: "block", fontSize: 14, fontWeight: 700, color: "var(--cc-text)" }}>
                              {name}
                            </span>
                            <span style={{ display: "block", fontSize: 13, color: "var(--cc-text-muted)" }}>
                              {description}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <Button
                  variant="primary"
                  fullWidth
                  disabled={!orgName.trim() || !orgType || saving}
                  onClick={saveOrg}
                >
                  {saving ? "Saving…" : "Continue"}
                </Button>
              </motion.div>
            )}

            {step === 1 && (
              <motion.div key="step1" variants={slide} initial="enter" animate="center" exit="exit" transition={{ duration: 0.25 }}>
                <p style={stepLabel}>Step 2 of 3</p>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
                  Invite your team
                </h1>
                <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24 }}>
                  They get an email with a link that joins them to {orgName || "your workspace"}. You can
                  skip this and do it from Settings later.
                </p>

                {error && <Notice tone="error">{error}</Notice>}

                <div style={{ display: "grid", gap: 8, marginBottom: 20 }}>
                  {teammates.map((email) => (
                    <div
                      key={email}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        background: "var(--cc-bg)",
                        border: "1px solid var(--cc-border)",
                        borderRadius: 8,
                        padding: "9px 12px",
                      }}
                    >
                      <span style={{ flex: 1, fontSize: 14, color: "var(--cc-text)" }}>{email}</span>
                      <button
                        type="button"
                        aria-label={`Remove ${email}`}
                        onClick={() => setTeammates(teammates.filter((e) => e !== email))}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", display: "flex" }}
                      >
                        <X size={16} />
                      </button>
                    </div>
                  ))}

                  <div style={{ display: "flex", gap: 8 }}>
                    <div style={{ flex: 1 }}>
                      <Input
                        type="email"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            addTeammate();
                          }
                        }}
                        placeholder="colleague@company.com"
                      />
                    </div>
                    <Button variant="secondary" onClick={addTeammate} aria-label="Add teammate">
                      <Plus size={16} />
                    </Button>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <Button variant="secondary" fullWidth disabled={saving} onClick={() => setStep(2)}>
                    Skip
                  </Button>
                  <Button variant="primary" fullWidth disabled={saving} onClick={sendInvites}>
                    {saving ? "Sending…" : teammates.length ? "Send invites" : "Continue"}
                  </Button>
                </div>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div
                key="step2"
                variants={slide}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.25 }}
                style={{ textAlign: "center" }}
              >
                <motion.span
                  initial={{ scale: 0.6, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", duration: 0.5 }}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 48,
                    height: 48,
                    borderRadius: 999,
                    background: "var(--cc-primary)",
                    marginBottom: 16,
                  }}
                >
                  <Check size={24} color="white" />
                </motion.span>

                <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 8 }}>
                  {orgName || "Your workspace"} is ready
                </h1>
                <p style={{ fontSize: 14, lineHeight: 1.6, color: "var(--cc-text-muted)", marginBottom: 24 }}>
                  {inviteNote ? `${inviteNote} ` : ""}
                  The dashboard has a checklist that walks you through the rest — a client, a campaign,
                  the creators on it, and the first payout.
                </p>

                <a href="/dashboard" style={{ textDecoration: "none", display: "block" }}>
                  <Button variant="primary" fullWidth>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      Go to the dashboard <ArrowRight size={15} />
                    </span>
                  </Button>
                </a>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
