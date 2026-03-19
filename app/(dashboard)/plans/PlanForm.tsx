"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
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
    <form onSubmit={handleSubmit} className="p-8 max-w-2xl mx-auto">
      <div className="mb-8">
        <h1 style={{ fontSize: 26, fontWeight: 900, color: "var(--cc-text)" }}>
          {isEdit ? "Edit Plan" : "New Plan"}
        </h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginTop: 4 }}>
          {isEdit ? "Update plan name, description, and features." : "Create a custom plan with feature toggles."}
        </p>
      </div>

      {error && (
        <div className="mb-6 px-4 py-3 rounded-xl text-sm" style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}>
          {error}
        </div>
      )}

      {/* Name */}
      <div className="mb-5">
        <label className="block mb-1.5 text-sm font-semibold" style={{ color: "var(--cc-text)" }}>
          Plan Name <span style={{ color: "#ef4444" }}>*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Enterprise Plus"
          className="w-full px-4 py-2.5 rounded-xl text-sm outline-none"
          style={{
            background: "var(--cc-surface)",
            border: "1px solid var(--cc-border)",
            color: "var(--cc-text)",
          }}
        />
      </div>

      {/* Description */}
      <div className="mb-8">
        <label className="block mb-1.5 text-sm font-semibold" style={{ color: "var(--cc-text)" }}>
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional description of this plan"
          rows={2}
          className="w-full px-4 py-2.5 rounded-xl text-sm outline-none resize-none"
          style={{
            background: "var(--cc-surface)",
            border: "1px solid var(--cc-border)",
            color: "var(--cc-text)",
          }}
        />
      </div>

      {/* Features */}
      <div
        className="rounded-2xl overflow-hidden mb-8"
        style={{ border: "1px solid var(--cc-border)" }}
      >
        <div
          className="px-5 py-3.5"
          style={{ background: "var(--cc-surface-2)", borderBottom: "1px solid var(--cc-border)" }}
        >
          <span style={{ fontWeight: 800, fontSize: 14, color: "var(--cc-text)" }}>Feature Toggles</span>
        </div>
        {featureKeys.map((key, i) => {
          const feat = FEATURES[key];
          const enabled = features[key] ?? false;
          return (
            <div
              key={key}
              className="flex items-center gap-4 px-5 py-4"
              style={{ borderBottom: i < featureKeys.length - 1 ? "1px solid var(--cc-border)" : "none" }}
            >
              <div className="flex-1 min-w-0">
                <div style={{ fontWeight: 600, fontSize: 14, color: "var(--cc-text)" }}>{feat.label}</div>
                <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 1 }}>{feat.description}</div>
              </div>
              {/* Toggle switch */}
              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                onClick={() => toggleFeature(key)}
                className="relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors duration-200"
                style={{ background: enabled ? "#2563EB" : "var(--cc-border)" }}
              >
                <span
                  className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow transition-transform duration-200 mt-0.5"
                  style={{ transform: enabled ? "translateX(20px)" : "translateX(2px)" }}
                />
              </button>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={saving}
          className="px-6 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
          style={{ background: "#2563EB" }}
        >
          {saving ? "Saving…" : isEdit ? "Save Changes" : "Create Plan"}
        </button>
        <button
          type="button"
          onClick={() => router.push("/plans")}
          className="px-6 py-2.5 rounded-xl text-sm font-semibold"
          style={{ background: "var(--cc-surface-2)", color: "var(--cc-text-muted)", border: "1px solid var(--cc-border)" }}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
