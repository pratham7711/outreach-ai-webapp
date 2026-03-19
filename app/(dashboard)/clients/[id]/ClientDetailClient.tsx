"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Save } from "lucide-react";
import { FEATURES, clientHasFeature, type FeatureKey } from "@/lib/features";

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
    <div className="p-8 max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <Link
        href="/clients"
        className="inline-flex items-center gap-1.5 text-sm mb-6"
        style={{ color: "var(--cc-text-muted)" }}
      >
        <ArrowLeft size={14} />
        Back to Clients
      </Link>

      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-bold"
          style={{ background: "var(--cc-surface-2)", color: "var(--cc-text)" }}
        >
          {client.name.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 900, color: "var(--cc-text)" }}>{client.name}</h1>
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginTop: 2 }}>
            {client.campaignCount} campaign{client.campaignCount !== 1 ? "s" : ""}
          </p>
        </div>
      </div>

      {/* Plan & Features card */}
      <div
        className="rounded-2xl overflow-hidden"
        style={{ border: "1px solid var(--cc-border)" }}
      >
        <div
          className="px-6 py-4"
          style={{ background: "var(--cc-surface-2)", borderBottom: "1px solid var(--cc-border)" }}
        >
          <span style={{ fontWeight: 800, fontSize: 15, color: "var(--cc-text)" }}>Plan & Features</span>
        </div>

        <div className="p-6" style={{ background: "var(--cc-surface)" }}>
          {error && (
            <div className="mb-5 px-4 py-3 rounded-xl text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
              {error}
            </div>
          )}
          {saved && (
            <div className="mb-5 px-4 py-3 rounded-xl text-sm" style={{ background: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}>
              Saved successfully
            </div>
          )}

          {/* Plan selector */}
          <div className="mb-6">
            <label className="block mb-1.5 text-sm font-semibold" style={{ color: "var(--cc-text)" }}>
              Assigned Plan
            </label>
            <select
              value={selectedPlanId}
              onChange={(e) => {
                setSelectedPlanId(e.target.value);
                // Reset overrides when plan changes
                const reset: Record<string, OverrideValue> = {};
                for (const key of featureKeys) reset[key] = "plan";
                setOverrides(reset);
              }}
              className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
              style={{
                background: "var(--cc-surface)",
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
              <p className="mt-2 text-xs" style={{ color: "var(--cc-text-muted)" }}>
                No plans yet.{" "}
                <Link href="/plans/new" style={{ color: "#3b82f6" }}>Create one</Link>
              </p>
            )}
          </div>

          {/* Feature overrides table */}
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--cc-border)" }}>
            <div
              className="grid grid-cols-[1fr_auto] px-4 py-2.5 text-xs font-semibold uppercase tracking-wide"
              style={{ background: "var(--cc-surface-2)", color: "var(--cc-text-muted)", borderBottom: "1px solid var(--cc-border)" }}
            >
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
                  className="flex items-center gap-4 px-4 py-3"
                  style={{ borderBottom: i < featureKeys.length - 1 ? "1px solid var(--cc-border)" : "none" }}
                >
                  {/* Feature info */}
                  <div className="flex-1 min-w-0 flex items-center gap-2.5">
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ background: effective ? "#22c55e" : "var(--cc-border)" }}
                    />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{feat.label}</div>
                      <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>{feat.description}</div>
                    </div>
                  </div>

                  {/* Override selector */}
                  <select
                    value={ov}
                    onChange={(e) => setOverrides((prev) => ({ ...prev, [key]: e.target.value as OverrideValue }))}
                    className="text-xs px-2.5 py-1.5 rounded-lg outline-none"
                    style={{
                      background: ov === "on" ? "rgba(34,197,94,0.1)" : ov === "off" ? "rgba(239,68,68,0.1)" : "var(--cc-surface-2)",
                      border: `1px solid ${ov === "on" ? "rgba(34,197,94,0.3)" : ov === "off" ? "rgba(239,68,68,0.3)" : "var(--cc-border)"}`,
                      color: ov === "on" ? "#22c55e" : ov === "off" ? "#ef4444" : "var(--cc-text-muted)",
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
          <div className="mt-5 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
              style={{ background: "#2563EB" }}
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
