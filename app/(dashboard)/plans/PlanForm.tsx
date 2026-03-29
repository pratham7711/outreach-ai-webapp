"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Input, Textarea, Card } from "@pratham7711/ui";
import { FEATURES, type FeatureKey } from "@/lib/features";

type PlanFormProps = {
  initial?: {
    id: string;
    name: string;
    description: string | null;
    features: Record<string, boolean>;
    isCustom: boolean;
  };
};

export default function PlanForm({ initial }: PlanFormProps) {
  const router = useRouter();
  const isEdit = !!initial;

  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [features, setFeatures] = useState<Record<string, boolean>>(() => {
    const base: Record<string, boolean> = {};
    for (const key of Object.keys(FEATURES)) {
      base[key] = initial?.features?.[key] ?? false;
    }
    return base;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const featureKeys = Object.keys(FEATURES) as FeatureKey[];

  function toggleFeature(key: FeatureKey) {
    setFeatures((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setError("Plan name is required"); return; }
    setSaving(true);
    setError(null);
    try {
      const url = isEdit ? `/api/plans/${initial.id}` : "/api/plans";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, features, isCustom: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data?.error?.formErrors?.[0] ?? "Failed to save plan");
        return;
      }
      router.push("/plans");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="cc-page-content" style={{ maxWidth: 640, margin: "0 auto" }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
          {isEdit ? "Edit Plan" : "New Plan"}
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
          {isEdit ? "Update plan name, description, and features." : "Create a custom plan with feature toggles."}
        </p>
      </div>

      {error && (
        <div style={{ marginBottom: 24, padding: "12px 16px", borderRadius: 10, fontSize: 14, background: "rgba(239,68,68,0.08)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Input
          label="Plan Name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Enterprise Plus"
          required
        />

        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description of this plan"
          rows={2}
        />

        {/* Features */}
        <Card variant="outlined" noPadding>
          <div style={{ padding: "14px 20px", borderBottom: "1px solid var(--cc-border)" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>Feature Toggles</span>
          </div>
          {featureKeys.map((key, i) => {
            const feat = FEATURES[key];
            const enabled = features[key] ?? false;
            return (
              <div
                key={key}
                className="cc-table-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "14px 20px",
                  borderBottom: i < featureKeys.length - 1 ? "1px solid var(--cc-border)" : "none",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--cc-text)" }}>{feat.label}</div>
                  <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 1 }}>{feat.description}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={enabled}
                  onClick={() => toggleFeature(key)}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 12,
                    border: "none",
                    cursor: "pointer",
                    position: "relative",
                    background: enabled ? "var(--cc-primary)" : "var(--cc-text-subtle)",
                    transition: "background 0.2s",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: 20,
                      height: 20,
                      borderRadius: "50%",
                      background: "white",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                      position: "absolute",
                      top: 2,
                      left: enabled ? 22 : 2,
                      transition: "left 0.2s",
                    }}
                  />
                </button>
              </div>
            );
          })}
        </Card>

        {/* Actions */}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Button type="submit" variant="primary" loading={saving}>
            {isEdit ? "Save Changes" : "Create Plan"}
          </Button>
          <Button type="button" variant="secondary" onClick={() => router.push("/plans")}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
