"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Pencil, Trash2, Users, X } from "lucide-react";
import { FEATURES, type FeatureKey } from "@/lib/features";

type Plan = {
  id: string;
  name: string;
  description: string | null;
  features: Record<string, boolean>;
  isCustom: boolean;
  clientCount: number;
  createdAt: string;
};

const featureKeys = Object.keys(FEATURES) as FeatureKey[];

function ToggleSwitch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      style={{
        width: 36,
        height: 20,
        borderRadius: 10,
        background: on ? "#22c55e" : "#D1D5DB",
        border: "none",
        cursor: "pointer",
        position: "relative",
        transition: "background 0.2s",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          background: "#fff",
          position: "absolute",
          top: 2,
          left: on ? 18 : 2,
          transition: "left 0.2s",
          boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
        }}
      />
    </button>
  );
}

function PlanModal({
  open,
  onClose,
  onSave,
  initial,
  title,
  saveLabel,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: { name: string; description: string; features: Record<string, boolean>; isCustom: boolean }) => Promise<void>;
  initial?: { name: string; description: string; features: Record<string, boolean>; isCustom: boolean };
  title: string;
  saveLabel: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [features, setFeatures] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    for (const key of featureKeys) init[key] = initial?.features?.[key] ?? false;
    return init;
  });
  const [isCustom, setIsCustom] = useState(initial?.isCustom ?? true);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      await onSave({ name: name.trim(), description: description.trim(), features, isCustom });
    } finally {
      setSaving(false);
    }
  }

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
          maxWidth: 560,
          maxHeight: "90vh",
          overflow: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: "1px solid var(--cc-border)" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>{title}</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ padding: 24 }}>
          {/* Name */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>
              Plan Name <span style={{ color: "#ef4444" }}>*</span>
            </label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Pro Plan"
              required
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 14,
                border: "1px solid var(--cc-border)",
                background: "var(--cc-card)",
                color: "var(--cc-text)",
                outline: "none",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Description */}
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional plan description..."
              rows={3}
              style={{
                width: "100%",
                padding: "10px 14px",
                borderRadius: 10,
                fontSize: 14,
                border: "1px solid var(--cc-border)",
                background: "var(--cc-card)",
                color: "var(--cc-text)",
                outline: "none",
                resize: "vertical",
                boxSizing: "border-box",
              }}
            />
          </div>

          {/* Custom toggle */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
            <ToggleSwitch on={isCustom} onChange={setIsCustom} />
            <span style={{ fontSize: 14, color: "var(--cc-text)" }}>Mark as custom plan</span>
          </div>

          {/* Feature Toggles */}
          <div style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-muted)", marginBottom: 12 }}>
              Feature Access
            </div>
            <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--cc-border)" }}>
              {featureKeys.map((key, i) => (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: i < featureKeys.length - 1 ? "1px solid var(--cc-border)" : "none",
                  }}
                >
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{FEATURES[key].label}</div>
                    <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{FEATURES[key].description}</div>
                  </div>
                  <ToggleSwitch on={features[key] ?? false} onChange={(v) => setFeatures((prev) => ({ ...prev, [key]: v }))} />
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
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
              type="submit"
              disabled={saving || !name.trim()}
              style={{
                padding: "10px 20px",
                borderRadius: 10,
                fontSize: 14,
                fontWeight: 600,
                background: "var(--cc-primary)",
                border: "none",
                color: "#fff",
                cursor: saving ? "not-allowed" : "pointer",
                opacity: saving || !name.trim() ? 0.6 : 1,
              }}
            >
              {saving ? "Saving..." : saveLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PlansClient({ plans: initialPlans }: { plans: Plan[] }) {
  const router = useRouter();
  const [plans, setPlans] = useState(initialPlans);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);

  async function handleDelete(id: string, clientCount: number) {
    if (clientCount > 0) {
      if (!confirm(`This plan has ${clientCount} client(s) assigned. They will be unassigned. Continue?`)) return;
    } else {
      if (!confirm("Delete this plan?")) return;
    }
    setDeleting(id);
    try {
      const res = await fetch(`/api/plans/${id}`, { method: "DELETE" });
      if (res.ok) {
        setPlans((prev) => prev.filter((p) => p.id !== id));
      }
    } finally {
      setDeleting(null);
    }
  }

  async function handleCreate(data: { name: string; description: string; features: Record<string, boolean>; isCustom: boolean }) {
    const res = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setShowCreate(false);
      router.refresh();
    }
  }

  async function handleEdit(data: { name: string; description: string; features: Record<string, boolean>; isCustom: boolean }) {
    if (!editingPlan) return;
    const res = await fetch(`/api/plans/${editingPlan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setEditingPlan(null);
      router.refresh();
    }
  }

  return (
    <div style={{ padding: "32px 40px 40px" }}>
      {/* Page Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Plans & Feature Access</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Manage subscription plans and feature access for clients</p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            background: "var(--cc-primary)",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "9px 16px",
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <Plus size={16} />
          New Plan
        </button>
      </div>

      {plans.length === 0 ? (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            padding: "80px 0",
            borderRadius: 12,
            border: "1px dashed var(--cc-border)",
            color: "var(--cc-text-muted)",
          }}
        >
          <div style={{ fontSize: 40, marginBottom: 16 }}>📋</div>
          <p style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>No plans yet</p>
          <p style={{ fontSize: 13, marginTop: 6, color: "var(--cc-text-muted)" }}>Create a plan to assign features to clients</p>
          <button
            onClick={() => setShowCreate(true)}
            style={{
              marginTop: 20,
              display: "flex",
              alignItems: "center",
              gap: 8,
              background: "var(--cc-primary)",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "9px 16px",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Plus size={15} />
            Create first plan
          </button>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(340px, 1fr))", gap: 20 }}>
          {plans.map((plan) => {
            const enabledCount = featureKeys.filter((k) => plan.features[k]).length;
            return (
              <div
                key={plan.id}
                style={{
                  background: "var(--cc-card)",
                  border: "1px solid var(--cc-border)",
                  borderRadius: 12,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                }}
              >
                {/* Card Header */}
                <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--cc-border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)" }}>{plan.name}</span>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        padding: "2px 8px",
                        borderRadius: 6,
                        background: plan.isCustom ? "rgba(34,197,94,0.1)" : "rgba(91,91,214,0.1)",
                        color: plan.isCustom ? "#16a34a" : "#5B5BD6",
                      }}
                    >
                      {plan.isCustom ? "Custom" : "Default"}
                    </span>
                  </div>
                  {plan.description && (
                    <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>{plan.description}</p>
                  )}
                </div>

                {/* Feature Flags Section */}
                <div style={{ padding: 20, flex: 1 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-muted)", marginBottom: 12 }}>
                    Feature Access ({enabledCount}/{featureKeys.length})
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" }}>
                    {featureKeys.map((key) => {
                      const on = plan.features[key] === true;
                      return (
                        <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 13, color: on ? "var(--cc-text)" : "var(--cc-text-muted)", opacity: on ? 1 : 0.6 }}>
                            {FEATURES[key].label}
                          </span>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              padding: "2px 8px",
                              borderRadius: 6,
                              background: on ? "rgba(34,197,94,0.1)" : "#F3F4F6",
                              color: on ? "#16a34a" : "var(--cc-text-muted)",
                              flexShrink: 0,
                            }}
                          >
                            {on ? "On" : "Off"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Footer */}
                <div style={{ padding: "14px 20px", borderTop: "1px solid var(--cc-border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                    <Users size={13} style={{ verticalAlign: "middle", marginRight: 4 }} />
                    {plan.clientCount} client{plan.clientCount !== 1 ? "s" : ""}
                  </span>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button
                      onClick={() => setEditingPlan(plan)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 12px",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 500,
                        background: "transparent",
                        border: "1px solid var(--cc-border)",
                        color: "var(--cc-text)",
                        cursor: "pointer",
                      }}
                    >
                      <Pencil size={13} />
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(plan.id, plan.clientCount)}
                      disabled={deleting === plan.id}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "6px 12px",
                        borderRadius: 8,
                        fontSize: 13,
                        fontWeight: 500,
                        background: "transparent",
                        border: "1px solid rgba(239,68,68,0.3)",
                        color: "#ef4444",
                        cursor: deleting === plan.id ? "not-allowed" : "pointer",
                        opacity: deleting === plan.id ? 0.5 : 1,
                      }}
                    >
                      <Trash2 size={13} />
                      Delete
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      <PlanModal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onSave={handleCreate}
        title="Create New Plan"
        saveLabel="Create Plan"
      />

      {/* Edit Modal */}
      {editingPlan && (
        <PlanModal
          open={true}
          onClose={() => setEditingPlan(null)}
          onSave={handleEdit}
          initial={{
            name: editingPlan.name,
            description: editingPlan.description ?? "",
            features: editingPlan.features,
            isCustom: editingPlan.isCustom,
          }}
          title={`Edit Plan — ${editingPlan.name}`}
          saveLabel="Save Changes"
        />
      )}
    </div>
  );
}
