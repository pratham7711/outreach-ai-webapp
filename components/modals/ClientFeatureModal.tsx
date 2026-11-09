"use client";
import { useState, useEffect } from "react";
import { Badge } from "@pratham7711/ui";
import { AlertCircle, SlidersHorizontal } from "lucide-react";
import { Modal, ModalNotice, ModalOption, ModalOptionList, ModalSection } from "@/components/ds/Modal";
import { FEATURES, type FeatureKey } from "@/lib/features";
import { Dropdown, Button } from "@/components/ds";
import { useDirty } from "@/lib/useDirty";

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
  /* What the dialog opened with; Save waits until something differs from it. */
  const [saved, setSaved] = useState<{ planId: string; overrides: Record<string, OverrideValue> } | null>(null);
  const dirty = useDirty(saved, { planId: selectedPlanId, overrides });

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
      setSaved({ planId: client.planId ?? "", overrides: init });
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
    fontSize: "var(--cc-t-11)",
    fontWeight: 600 as const,
    borderRadius: 6,
    border: "none",
    cursor: "pointer" as const,
    background: active ? color : "transparent",
    color: active ? "var(--cc-on-primary)" : "var(--cc-text-muted)",
    transition: "all 0.15s",
  });

  const planFeatureCount = selectedPlan ? featureKeys.filter((k) => selectedPlan.features[k]).length : null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={SlidersHorizontal}
      title="Feature access"
      description={
        <>
          Pick the plan for <strong className="cc-dialog__subject">{client.name}</strong>, then force single features on or
          off.
        </>
      }
      size="lg"
      dismissible={false}
      footer={
        <div className="cc-modal-footer" data-layout="split" data-align="center" data-gap="0">
          <span className="cc-dialog-meta">
            {overrideCount > 0 ? `${overrideCount} override${overrideCount > 1 ? "s" : ""}` : "No overrides"}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={handleSave}>
              Save Changes
            </Button>
          </div>
        </div>
      }
    >
      {error && (
        <ModalNotice tone="danger" icon={AlertCircle}>
          {error}
        </ModalNotice>
      )}

      <ModalSection
        title="Plan"
        description="Features follow this plan unless overridden below."
        aside={
          planFeatureCount !== null ? (
            <span className="cc-dialog-meta">
              {planFeatureCount}/{featureKeys.length} features
            </span>
          ) : undefined
        }
      >
        <Dropdown
          ariaLabel="Plan Assignment"
          align="left"
          fullWidth
          value={selectedPlanId}
          onChange={setSelectedPlanId}
          options={[
            { value: "", label: "— No plan —" },
            ...plans.map((p) => ({ value: p.id, label: p.name })),
          ]}
        />
      </ModalSection>

      <ModalSection title="Feature overrides" description="Override individual features regardless of plan.">
        <ModalOptionList>
          {featureKeys.map((key) => {
            const planVal = selectedPlan?.features?.[key] ?? false;
            const ov = overrides[key] ?? "plan";
            const effective = getEffective(key);
            return (
              <ModalOption
                key={key}
                as="div"
                title={FEATURES[key].label}
                description={`Plan: ${planVal ? "ON" : "OFF"}`}
                control={
                  <span className="flex items-center gap-3">
                    <span
                      role="group"
                      aria-label={`${FEATURES[key].label} override`}
                      style={{ display: "flex", gap: 2, background: "var(--cc-hover-bg)", borderRadius: 8, padding: 2 }}
                    >
                      <button
                        type="button"
                        aria-pressed={ov === "plan"}
                        onClick={() => setOverrides((prev) => ({ ...prev, [key]: "plan" }))}
                        style={segmentStyle(ov === "plan", "var(--cc-text-muted)")}
                      >
                        Default
                      </button>
                      <button
                        type="button"
                        aria-pressed={ov === "on"}
                        onClick={() => setOverrides((prev) => ({ ...prev, [key]: "on" }))}
                        style={segmentStyle(ov === "on", "var(--cc-success)")}
                      >
                        Force ON
                      </button>
                      <button
                        type="button"
                        aria-pressed={ov === "off"}
                        onClick={() => setOverrides((prev) => ({ ...prev, [key]: "off" }))}
                        style={segmentStyle(ov === "off", "var(--cc-danger)")}
                      >
                        Force OFF
                      </button>
                    </span>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: "50%",
                        background: effective ? "var(--cc-success)" : "var(--cc-text-subtle)",
                        flexShrink: 0,
                      }}
                      title={`Effective: ${effective ? "ON" : "OFF"}`}
                    />
                  </span>
                }
              />
            );
          })}
        </ModalOptionList>
      </ModalSection>

      <ModalSection title={`Effective access: ${enabledCount}/${featureKeys.length} features`}>
        <div className="flex flex-wrap gap-1.5">
          {featureKeys.map((key) => {
            const on = getEffective(key);
            return (
              <Badge key={key} variant={on ? "success" : "neutral"} size="sm" outlined>
                {FEATURES[key].label}
              </Badge>
            );
          })}
        </div>
      </ModalSection>
    </Modal>
  );
}
