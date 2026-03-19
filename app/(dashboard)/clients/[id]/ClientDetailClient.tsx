"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { FEATURES, type FeatureKey } from "@/lib/features";

type Plan = { id: string; name: string; features: Record<string, boolean> };

type ClientProps = {
  id: string;
  name: string;
  logoUrl: string | null;
  contactInfo: unknown;
  planId: string | null;
  featureOverrides: Record<string, boolean> | null;
  campaignCount: number;
  plan: Plan | null;
};

type Props = {
  client: ClientProps;
  plans: Plan[];
};

type OverrideValue = "plan" | "on" | "off";

export default function ClientDetailClient({ client, plans }: Props) {
  const router = useRouter();
  const featureKeys = Object.keys(FEATURES) as FeatureKey[];

  const [selectedPlanId, setSelectedPlanId] = useState<string>(client.planId ?? "");
  const [overrides, setOverrides] = useState<Record<string, OverrideValue>>(() => {
    const init: Record<string, OverrideValue> = {};
    for (const key of featureKeys) {
      const ov = client.featureOverrides?.[key];
      if (ov === true) init[key] = "on";
      else if (ov === false) init[key] = "off";
      else init[key] = "plan";
    }
    return init;
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  function getEffectiveValue(key: FeatureKey): boolean {
    if (overrides[key] === "on") return true;
    if (overrides[key] === "off") return false;
    return selectedPlan?.features?.[key] ?? false;
  }

  function buildOverridesPayload(): Record<string, boolean> | null {
    const result: Record<string, boolean> = {};
    let hasAny = false;
    for (const key of featureKeys) {
      if (overrides[key] === "on") { result[key] = true; hasAny = true; }
      else if (overrides[key] === "off") { result[key] = false; hasAny = true; }
    }
    return hasAny ? result : null;
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/clients/${client.id}/plan`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId: selectedPlanId || null,
          featureOverrides: buildOverridesPayload(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data?.error ?? "Failed to save");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: 32, maxWidth: 720, margin: "0 auto" }}>
      {/* Breadcrumb */}
      <Link
        href="/clients"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 14, color: "var(--cc-text-muted)", textDecoration: "none", marginBottom: 24 }}
      >
        <ArrowLeft size={14} />
        Back to Clients
      </Link>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 32 }}>
        <div style={{ width: 56, height: 56, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, background: "#F3F4F8", color: "var(--cc-text)" }}>
          {client.name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--cc-text)", marginBottom: 2 }}>{client.name}</h1>
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            {client.campaignCount} campaign{client.campaignCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Plan & Features card */}
      <div style={{ borderRadius: 16, overflow: "hidden", border: "1px solid var(--cc-border)" }}>
        <div style={{ padding: "14px 24px", background: "#F3F4F8", borderBottom: "1px solid var(--cc-border)" }}>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>Plan & Features</span>
        </div>

        <div style={{ padding: 24, background: "var(--cc-card)" }}>
          {error && (
            <div style={{ marginBottom: 20, padding: "10px 16px", borderRadius: 10, fontSize: 14, background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
              {error}
            </div>
          )}
          {saved && (
            <div style={{ marginBottom: 20, padding: "10px 16px", borderRadius: 10, fontSize: 14, background: "rgba(34,197,94,0.08)", color: "#16a34a", border: "1px solid rgba(34,197,94,0.2)" }}>
              Saved successfully
            </div>
          )}

          {/* Plan selector */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", marginBottom: 6, fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
              Assigned Plan
            </label>
            <select
              value={selectedPlanId}
              onChange={(e) => {
                setSelectedPlanId(e.target.value);
                const reset: Record<string, OverrideValue> = {};
                for (const key of featureKeys) reset[key] = "plan";
                setOverrides(reset);
              }}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 14,
                outline: "none",
                background: "var(--cc-card)",
                border: "1px solid var(--cc-border)",
                color: "var(--cc-text)",
              }}
            >
              <option value="">— No plan —</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            {plans.length === 0 && (
              <p style={{ marginTop: 8, fontSize: 12, color: "var(--cc-text-muted)" }}>
                No plans yet.{" "}
                <Link href="/plans/new" style={{ color: "var(--cc-primary)" }}>Create one</Link>
              </p>
            )}
          </div>

          {/* Feature overrides table */}
          <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--cc-border)" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", padding: "10px 16px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", background: "#F9FAFB", color: "var(--cc-text-muted)", borderBottom: "1px solid var(--cc-border)" }}>
              <span>Feature</span>
              <span>Override</span>
            </div>
            {featureKeys.map((key, i) => {
              const feat = FEATURES[key];
              const effective = getEffectiveValue(key);
              const ov = overrides[key];
              return (
                <div
                  key={key}
                  style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 16px", borderBottom: i < featureKeys.length - 1 ? "1px solid var(--cc-border)" : "none" }}
                >
                  <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: effective ? "#22c55e" : "var(--cc-border)" }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{feat.label}</div>
                      <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>{feat.description}</div>
                    </div>
                  </div>

                  <select
                    value={ov}
                    onChange={(e) => setOverrides((prev) => ({ ...prev, [key]: e.target.value as OverrideValue }))}
                    style={{
                      fontSize: 12,
                      padding: "6px 10px",
                      borderRadius: 8,
                      outline: "none",
                      background: ov === "on" ? "rgba(34,197,94,0.08)" : ov === "off" ? "rgba(239,68,68,0.08)" : "#F3F4F8",
                      border: `1px solid ${ov === "on" ? "rgba(34,197,94,0.3)" : ov === "off" ? "rgba(239,68,68,0.3)" : "var(--cc-border)"}`,
                      color: ov === "on" ? "#16a34a" : ov === "off" ? "#ef4444" : "var(--cc-text-muted)",
                    }}
                  >
                    <option value="plan">Use plan default</option>
                    <option value="on">Force ON</option>
                    <option value="off">Force OFF</option>
                  </select>
                </div>
              );
            })}
          </div>

          {/* Save */}
          <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 12 }}>
            <button
              onClick={handleSave}
              disabled={saving}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 10, fontSize: 14, fontWeight: 600, color: "white", background: "var(--cc-primary)", border: "none", cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.6 : 1 }}
            >
              <Save size={14} />
              {saving ? "Saving…" : "Save Plan & Overrides"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
