"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Pencil, Trash2, Users, ClipboardList } from "lucide-react";
import { Button, Card, Modal, Input, Textarea, EmptyState, Badge } from "@pratham7711/ui";
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
        background: on ? "#22c55e" : "var(--cc-text-subtle)",
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
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={saving}
            onClick={() => {
              document.getElementById("plan-modal-form")?.dispatchEvent(
                new Event("submit", { cancelable: true, bubbles: true })
              );
            }}
          >
            {saveLabel}
          </Button>
        </div>
      }
    >
      <form id="plan-modal-form" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Input
          label="Plan Name *"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Pro Plan"
          required
        />

        <Textarea
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional plan description..."
          rows={3}
        />

        {/* Custom toggle */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <ToggleSwitch on={isCustom} onChange={setIsCustom} />
          <span style={{ fontSize: 14, color: "var(--cc-text)" }}>Mark as custom plan</span>
        </div>

        {/* Feature Toggles */}
        <div>
          <div style={{ fontSize: 13, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-muted)", marginBottom: 12 }}>
            Feature Access
          </div>
          <div style={{ borderRadius: 10, overflow: "hidden", border: "1px solid var(--cc-border)" }}>
            {featureKeys.map((key, i) => (
              <div
                key={key}
                className="cc-table-row"
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
      </form>
    </Modal>
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
    <div className="rsp-page page-enter">
      <style>{`.plan-feat-grid{display:grid;grid-template-columns:1fr;gap:8px 16px}@media(min-width:480px){.plan-feat-grid{grid-template-columns:1fr 1fr}}`}</style>
      {/* Page Header */}
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Plans & Feature Access</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Manage subscription plans and feature access for clients</p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowCreate(true)}>
          New Plan
        </Button>
      </div>

      {plans.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={32} color="var(--cc-text-subtle)" />}
          title="No plans yet"
          description="Create a plan to assign features to clients"
          action={
            <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowCreate(true)}>
              Create first plan
            </Button>
          }
        />
      ) : (
        <div className="cc-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 20 }}>
          {plans.map((plan) => {
            const enabledCount = featureKeys.filter((k) => plan.features[k]).length;
            return (
              <Card key={plan.id} variant="outlined" noPadding>
                {/* Card Header */}
                <div style={{ padding: "20px 20px 16px", borderBottom: "1px solid var(--cc-border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)" }}>{plan.name}</span>
                    <Badge variant={plan.isCustom ? "success" : "accent"} size="sm">
                      {plan.isCustom ? "Custom" : "Default"}
                    </Badge>
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
                  <div className="plan-feat-grid">
                    {featureKeys.map((key) => {
                      const on = plan.features[key] === true;
                      return (
                        <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: 13, color: on ? "var(--cc-text)" : "var(--cc-text-muted)", opacity: on ? 1 : 0.6 }}>
                            {FEATURES[key].label}
                          </span>
                          <Badge variant={on ? "success" : "neutral"} size="sm">
                            {on ? "On" : "Off"}
                          </Badge>
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
                    <Button variant="ghost" size="sm" iconLeft={<Pencil size={13} />} onClick={() => setEditingPlan(plan)}>
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      iconLeft={<Trash2 size={13} />}
                      loading={deleting === plan.id}
                      onClick={() => handleDelete(plan.id, plan.clientCount)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
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
