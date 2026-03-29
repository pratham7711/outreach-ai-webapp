"use client";
import { useState, useEffect } from "react";
import { Modal, Button, Badge } from "@pratham7711/ui";
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

  const selectStyle = {
    flex: 1,
    padding: "10px 14px",
    borderRadius: 10,
    fontSize: 14,
    border: "1px solid var(--cc-border)",
    background: "var(--cc-card)",
    color: "var(--cc-text)",
    outline: "none",
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Feature Access — ${client.name}`}
      size="lg"
      footer={
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", width: "100%" }}>
          <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
            {overrideCount > 0 ? `${overrideCount} override${overrideCount > 1 ? "s" : ""}` : "No overrides"}
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={handleSave}>
              Save Changes
            </Button>
          </div>
        </div>
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        {error && (
          <div style={{ padding: "10px 16px", borderRadius: 10, fontSize: 14, background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
            {error}
          </div>
        )}

        {/* Section 1: Plan Assignment */}
        <div>
          <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--cc-text)", marginBottom: 8 }}>
            Plan Assignment
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <select
              value={selectedPlanId}
              onChange={(e) => setSelectedPlanId(e.target.value)}
              style={selectStyle}
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
        <div>
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
                  className="cc-table-row"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "10px 16px",
                    borderBottom: i < featureKeys.length - 1 ? "1px solid var(--cc-border)" : "none",
                    background: ov !== "plan" ? "var(--cc-row-hover)" : "transparent",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 500, color: "var(--cc-text)" }}>{FEATURES[key].label}</div>
                    <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>
                      Plan: {planVal ? "ON" : "OFF"}
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 2, background: "var(--cc-hover-bg)", borderRadius: 8, padding: 2 }}>
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

                  <div
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: effective ? "#22c55e" : "var(--cc-text-subtle)",
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
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 8 }}>
            Effective access: {enabledCount}/{featureKeys.length} features
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {featureKeys.map((key) => {
              const on = getEffective(key);
              return (
                <Badge
                  key={key}
                  variant={on ? "success" : "neutral"}
                  size="sm"
                  outlined
                >
                  {FEATURES[key].label}
                </Badge>
              );
            })}
          </div>
        </div>
      </div>
    </Modal>
  );
}
