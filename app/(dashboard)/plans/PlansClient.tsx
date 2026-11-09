"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Plus, Pencil, Trash2, Users, ClipboardList } from "lucide-react";
import { Card, EmptyState } from "@pratham7711/ui";
import { Modal, ModalSection } from "@/components/ds/Modal";
import { FEATURES } from "@/lib/features";
import { PageHeader, useConfirm, Button, MoreMenu, StatusBadge } from "@/components/ds";
import { useDirty } from "@/lib/useDirty";
import { toast } from "sonner";
import { action } from "@/lib/ui/actions";
import {
  PlanDetailsFields,
  PlanFeatureList,
  enabledCount,
  featureKeys,
  planDraft,
  type PlanDraft,
} from "./planFields";

type Plan = {
  id: string;
  name: string;
  description: string | null;
  features: Record<string, boolean>;
  isCustom: boolean;
  clientCount: number;
  createdAt: string;
};

function PlanModal({
  open,
  onClose,
  onSave,
  initial,
  title,
  saveLabel,
  icon = ClipboardList,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: PlanDraft) => Promise<void>;
  initial?: { name: string; description: string; features: Record<string, boolean>; isCustom: boolean };
  title: string;
  saveLabel: string;
  icon?: React.ElementType;
}) {
  /* The snapshot an Edit is compared with; null for a new plan, whose Create
     waits for the required name instead of for a change. */
  const [saved] = useState<PlanDraft | null>(() => (initial ? planDraft(initial) : null));
  const [draft, setDraft] = useState<PlanDraft>(() => planDraft(initial));
  const [saving, setSaving] = useState(false);
  const dirty = useDirty(saved, draft);
  const named = draft.name.trim().length > 0;
  const canSave = named && (saved === null || dirty) && !saving;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      await onSave({ ...draft, name: draft.name.trim(), description: draft.description.trim() });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      icon={icon}
      title={title}
      description="Name the plan and choose which features clients on it can use."
      size="lg"
      dismissible={false}
      footer={
        <div className="cc-modal-footer">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="sm"
            loading={saving}
            disabled={!canSave}
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
      <form id="plan-modal-form" onSubmit={handleSubmit} noValidate>
        <ModalSection title="Details">
          <div className="cc-dialog-stack">
            <PlanDetailsFields draft={draft} onChange={setDraft} autoFocus />
          </div>
        </ModalSection>

        <ModalSection
          title="Feature access"
          aside={
            <span className="cc-dialog-meta">
              {enabledCount(draft)} of {featureKeys.length} on
            </span>
          }
        >
          <PlanFeatureList draft={draft} onChange={setDraft} />
        </ModalSection>
      </form>
    </Modal>
  );
}

export default function PlansClient({ plans: initialPlans }: { plans: Plan[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [plans, setPlans] = useState(initialPlans);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);

  async function handleDelete(plan: Plan) {
    const { id, clientCount } = plan;
    const ok = await confirm(
      clientCount > 0
        ? {
            verb: "delete",
            subject: plan.name,
            description: `${clientCount === 1 ? "Its client" : `Its ${clientCount} clients`} will be left with no plan, so their feature access falls back to the defaults until you assign a new plan. This can't be undone.`,
            confirmLabel: "Delete and unassign",
          }
        : {
            verb: "delete",
            subject: plan.name,
            description: "No clients are assigned to it, so nothing else changes. This can't be undone.",
          },
    );
    if (!ok) return;
    setDeleting(id);
    try {
      const res = await fetch(`/api/plans/${id}`, { method: "DELETE" });
      if (res.ok) {
        setPlans((prev) => prev.filter((p) => p.id !== id));
      } else {
        // The card used to just stay on screen with nothing said, which reads
        // like the confirm never fired.
        toast.error("Couldn't delete that plan. It is unchanged.");
      }
    } catch {
      toast.error("The request didn't go through. The plan is unchanged.");
    } finally {
      setDeleting(null);
    }
  }

  async function handleCreate(data: PlanDraft) {
    const res = await fetch("/api/plans", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setShowCreate(false);
      router.refresh();
      return;
    }
    // Leave the modal open with what was typed still in it.
    toast.error("Couldn't create that plan. Nothing was saved.");
  }

  async function handleEdit(data: PlanDraft) {
    if (!editingPlan) return;
    const res = await fetch(`/api/plans/${editingPlan.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      setEditingPlan(null);
      router.refresh();
      return;
    }
    toast.error("Couldn't save those changes. The plan is unchanged.");
  }

  return (
    <div className="rsp-page page-enter">
      <style>{`.plan-feat-grid{display:grid;grid-template-columns:1fr;gap:8px 16px}@media(min-width:480px){.plan-feat-grid{grid-template-columns:1fr 1fr}}`}</style>
      <PageHeader
        title="Plans"
        subtitle="Subscription plans and the features clients on each can use."
        actions={
          <Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setShowCreate(true)} {...action("new-plan")}>
            New plan
          </Button>
        }
      />

      {plans.length === 0 ? (
        <EmptyState
          icon={<ClipboardList size={32} color="var(--cc-text-subtle)" />}
          title="No plans yet"
          description="Create a plan to assign features to clients"
          action={
            <Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setShowCreate(true)}>
              Create first plan
            </Button>
          }
        />
      ) : (
        <div className="cc-stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 300px), 1fr))", gap: 24 }}>
          {plans.map((plan) => {
            const on = enabledCount(plan);
            return (
              /* A column, so the footer is pushed to the card's foot and
                 lines up across a row even when one description wraps. */
              <Card
                key={plan.id}
                variant="outlined"
                noPadding
                aria-busy={deleting === plan.id || undefined}
                style={{ display: "flex", flexDirection: "column", opacity: deleting === plan.id ? 0.6 : undefined }}
              >
                <div style={{ padding: "var(--cc-card-inset)", borderBottom: "1px solid var(--cc-border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    <h2 style={{ margin: 0, fontSize: "var(--cc-t-16)", fontWeight: 600, color: "var(--cc-text)" }}>{plan.name}</h2>
                    <StatusBadge tone={plan.isCustom ? "info" : "neutral"}>{plan.isCustom ? "Custom" : "Default"}</StatusBadge>
                  </div>
                  <p
                    title={plan.description ?? undefined}
                    style={{
                      fontSize: "var(--cc-t-14)", lineHeight: 1.5, color: "var(--cc-text-muted)", margin: "4px 0 0",
                      minHeight: "3em", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
                    }}
                  >
                    {plan.description}
                  </p>
                </div>

                <div style={{ padding: "var(--cc-card-inset)" }}>
                  <div className="cc-microlabel" style={{ marginBottom: 12 }}>
                    Feature access · {on} of {featureKeys.length}
                  </div>
                  <div className="plan-feat-grid">
                    {featureKeys.map((key) => {
                      const enabled = plan.features[key] === true;
                      return (
                        <div key={key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                          <span style={{ fontSize: "var(--cc-t-13)", color: enabled ? "var(--cc-text)" : "var(--cc-text-muted)" }}>
                            {FEATURES[key].label}
                          </span>
                          <StatusBadge tone={enabled ? "success" : "neutral"}>{enabled ? "On" : "Off"}</StatusBadge>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div
                  style={{
                    marginTop: "auto",
                    padding: "12px var(--cc-card-inset)",
                    borderTop: "1px solid var(--cc-border)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 12,
                  }}
                >
                  {/* inline-flex: the library resets svg to display:block, so
                      an icon in a plain inline span sat on its own line. */}
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
                    <Users size={14} aria-hidden="true" />
                    {plan.clientCount} client{plan.clientCount !== 1 ? "s" : ""}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Button variant="secondary" size="sm" iconLeft={<Pencil size={14} />} onClick={() => setEditingPlan(plan)}>
                      Edit
                    </Button>
                    <MoreMenu
                      size="sm"
                      label={`More actions for ${plan.name}`}
                      items={[
                        {
                          label: "Delete plan",
                          icon: <Trash2 size={16} aria-hidden="true" />,
                          danger: true,
                          onClick: () => handleDelete(plan),
                        },
                      ]}
                    />
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
        title="New plan"
        saveLabel="Create plan"
        icon={Plus}
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
          title={`Edit ${editingPlan.name}`}
          saveLabel="Save changes"
          icon={Pencil}
        />
      )}
    </div>
  );
}
