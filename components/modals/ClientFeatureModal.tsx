"use client";
import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { FEATURES, type FeatureKey } from "@/lib/features";

const featureKeys = Object.keys(FEATURES) as FeatureKey[];

type OverrideValue = "plan" | "on" | "off";

type Plan = { id: string; name: string; features: Record<string, boolean> };

type ClientData = {
  id: string;
  name: string;
  planId: string | null;
  featureOverrides: Record<string, boolean> | null;
};

interface ClientFeatureModalProps {
  open: boolean;
  onClose: () => void;
  client: ClientData;
  plans: Plan[];
  onSave: () => void;
}

export default function ClientFeatureModal({ open, onClose, client, plans, onSave }: ClientFeatureModalProps) {
  const [selectedPlanId, setSelectedPlanId] = useState(client.planId ?? "");
  const [overrides, setOverrides] = useState<Record<string, OverrideValue>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSelectedPlanId(client.planId ?? "");
      const init: Record<string, OverrideValue> = {};
      for (const key of featureKeys) {
        const ov = client.featureOverrides?.[key];
        if (ov === true) init[key] = "on";
        else if (ov === false) init[key] = "off";
        else init[key] = "plan";
      }
      setOverrides(init);
      setError(null);
    }
  }, [open, client]);

  if (!open) return null;

  const selectedPlan = plans.find((p) => p.id === selectedPlanId) ?? null;

  function getEffective(key: FeatureKey): boolean {
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

  const overrideCount = featureKeys.filter((k) => overrides[k] !== "plan").length;
  const enabledCount = featureKeys.filter((k) => getEffective(k)).length;

  async function handleSave() {
    setSaving(true);
    setError(null);
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
      onSave();
      onClose();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  const segmentStyle = (active: boolean, color: string) => ({
    padding: "4px 10px",
    fontSize: 11,
    fontWeight: 600 as const,
    borderRadius: 6,
    border: "none",
    cursor: "pointer" as const,
    background: active ? color : "transparent",
    color: active ? "#fff" : "var(--cc-text-muted)",
    transition: "all 0.15s",
  });

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.4)",
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        style={{
          background: "var(--cc-card)",
          borderRadius: 16,
          width: "100%",
          maxWidth: 620,
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: "1px solid var(--cc-border)" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
            Feature Access — {client.name}
          </h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <div style={{ padding: 24 }}>
          {error && (
            <div style={{ marginBottom: 16, padding: "10px 16px", borderRadius: 10, fontSize: 14, background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
              {error}
            </div>
          )}

          {/* Section 1: Plan Assignment */}
          <div style={{ marginBottom: 24 }}>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--cc-text)", marginBottom: 8 }}>
              Plan Assignment
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <select
                value={selectedPlanId}
                onChange={(e) => setSelectedPlanId(e.target.value)}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 10,
                  fontSize: 14,
                  border: "1px solid var(--cc-border)",
                  background: "var(--cc-card)",
                  color: "var(--cc-text)",
                  outline: "none",
                }}
              >
                <option value="">— No plan —</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              {selectedPlan && (
                <span style={{ fontSize: 12, color: "var(--cc-text-muted)", whiteSpace: "nowrap" }}>
                  {featureKeys.filter((k) => selectedPlan.features[k]).length}/{featureKeys.length} features
                </span>
              )}
            </div>
          </div>

          {/* Section 2: Feature Overrides */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", marginBottom: 4 }}>
              Feature Overrides
            </div>
            <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "0 0 12px" }}>
              Override individual features regardless of plan
            </p>

            <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--cc-border)" }}>
              {featureKeys.map((key, i) => {
                const planVal = selectedPlan?.features?.[key] ?? false;
                const ov = overrides[key] ?? "plan";
                const effective = getEffective(key);
                return (
                  <div
                    key={key}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 16px",
                      borderBottom: i < featureKeys.length - 1 ? "1px solid var(--cc-border)" : "none",
                      background: ov !== "plan" ? "rgba(91,91,214,0.03)" : "transparent",
                    }}
                  >
                    {/* Feature name + plan status */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 500, color: "var(--cc-text)" }}>{FEATURES[key].label}</div>
                      <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>
                        Plan: {planVal ? "ON" : "OFF"}
                      </div>
                    </div>

                    {/* 3-segment pill */}
                    <div style={{ display: "flex", gap: 2, background: "#F3F4F6", borderRadius: 8, padding: 2 }}>
                      <button
                        type="button"
                        onClick={() => setOverrides((prev) => ({ ...prev, [key]: "plan" }))}
                        style={segmentStyle(ov === "plan", "#6B7280")}
                      >
                        Default
                      </button>
                      <button
                        type="button"
                        onClick={() => setOverrides((prev) => ({ ...prev, [key]: "on" }))}
                        style={segmentStyle(ov === "on", "#16a34a")}
                      >
                        Force ON
                      </button>
                      <button
                        type="button"
                        onClick={() => setOverrides((prev) => ({ ...prev, [key]: "off" }))}
                        style={segmentStyle(ov === "off", "#ef4444")}
                      >
                        Force OFF
                      </button>
                    </div>

                    {/* Effective indicator */}
                    <div
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: effective ? "#22c55e" : "#D1D5DB",
                        flexShrink: 0,
                      }}
                      title={`Effective: ${effective ? "ON" : "OFF"}`}
                    />
                  </div>
                );
              })}
            </div>
          </div>

          {/* Section 3: Summary */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 8 }}>
              Effective access: {enabledCount}/{featureKeys.length} features
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {featureKeys.map((key) => {
                const on = getEffective(key);
                return (
                  <span
                    key={key}
                    style={{
                      fontSize: 11,
                      fontWeight: 500,
                      padding: "3px 10px",
                      borderRadius: 6,
                      border: `1px solid ${on ? "rgba(34,197,94,0.3)" : "var(--cc-border)"}`,
                      background: on ? "rgba(34,197,94,0.06)" : "transparent",
                      color: on ? "#16a34a" : "var(--cc-text-muted)",
                    }}
                  >
                    {FEATURES[key].label}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
              {overrideCount > 0 ? `${overrideCount} override${overrideCount > 1 ? "s" : ""}` : "No overrides"}
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                type="button"
                onClick={onClose}
                style={{
                  padding: "10px 20px",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  background: "var(--cc-card)",
                  border: "1px solid var(--cc-border)",
                  color: "var(--cc-text)",
                  cursor: "pointer",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  padding: "10px 20px",
                  borderRadius: 10,
                  fontSize: 14,
                  fontWeight: 600,
                  background: "var(--cc-primary)",
                  border: "none",
                  color: "#fff",
                  cursor: saving ? "not-allowed" : "pointer",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
