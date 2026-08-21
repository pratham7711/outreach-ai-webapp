"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Zap } from "lucide-react";
import { Button, Badge, EmptyState, Card, Avatar, Modal, Input } from "@pratham7711/ui";
import { MetricTile, EntityPicker } from "@/components/ds";
import type { PickerOption } from "@/components/ds";
import { toast } from "sonner";
import { stripAt } from "@/lib/format";

type Activation = {
  id: string;
  status: string;
  createdAt: string;
  creator: { id: string; name: string; handle: string; platform: string; avatarUrl: string | null };
  campaign: { id: string; title: string };
};

const COLUMNS = [
  "AWAITING_DRAFT", "DRAFT_SUBMITTED", "AWAITING_APPROVAL", "APPROVED",
  "POSTING", "POSTED", "COMPLETE", "DECLINED",
] as const;

const COLUMN_LABELS: Record<string, string> = {
  AWAITING_DRAFT: "Awaiting Draft", DRAFT_SUBMITTED: "Draft Submitted",
  AWAITING_APPROVAL: "Awaiting Approval", APPROVED: "Approved",
  POSTING: "Posting", POSTED: "Posted", COMPLETE: "Complete", DECLINED: "Declined",
};

const COLUMN_COLORS: Record<string, string> = {
  AWAITING_DRAFT: "#f59e0b", DRAFT_SUBMITTED: "#3b82f6", AWAITING_APPROVAL: "#f59e0b",
  APPROVED: "#22c55e", POSTING: "var(--cc-primary)", POSTED: "#22c55e",
  COMPLETE: "#16a34a", DECLINED: "#ef4444",
};

const NEXT_STATUS: Record<string, { label: string; status: string }[]> = {
  AWAITING_DRAFT: [{ label: "Submit Draft", status: "DRAFT_SUBMITTED" }],
  DRAFT_SUBMITTED: [{ label: "Review", status: "AWAITING_APPROVAL" }],
  AWAITING_APPROVAL: [{ label: "Approve", status: "APPROVED" }, { label: "Decline", status: "DECLINED" }],
  APPROVED: [{ label: "Start Posting", status: "POSTING" }],
  POSTING: [{ label: "Mark Posted", status: "POSTED" }],
  POSTED: [{ label: "Complete", status: "COMPLETE" }],
  DECLINED: [{ label: "Re-open", status: "AWAITING_DRAFT" }],
};

export default function ActivationsClient({ activations, stats }: {
  activations: Activation[];
  stats: { total: number; active: number };
}) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [campaign, setCampaign] = useState<PickerOption | null>(null);
  const [creator, setCreator] = useState<PickerOption | null>(null);
  const [creating, setCreating] = useState(false);

  const grouped = new Map<string, Activation[]>();
  for (const col of COLUMNS) grouped.set(col, []);
  for (const a of activations) {
    const col = COLUMNS.includes(a.status as typeof COLUMNS[number]) ? a.status : "AWAITING_DRAFT";
    grouped.get(col)!.push(a);
  }

  const handleStatusChange = async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/activations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast.success(`Moved to ${COLUMN_LABELS[status]}`);
        router.refresh();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed");
      }
    } catch { toast.error("Network error"); }
  };

  const handleCreate = async () => {
    if (!campaign || !creator) return;
    setCreating(true);
    try {
      const res = await fetch("/api/activations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: campaign.id, creatorId: creator.id }),
      });
      if (res.ok) {
        toast.success("Activation created");
        setShowCreate(false);
        setCampaign(null);
        setCreator(null);
        router.refresh();
      } else {
        toast.error("Failed to create");
      }
    } finally { setCreating(false); }
  };

  return (
    <div className="rsp-page">
      {/* Header */}
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Activations</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Track creator deliverables and posts</p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowCreate(true)}>Add Activation</Button>
      </div>

      {/* Stats */}
      <div className="rsp-grid-tiles" style={{ marginBottom: 32 }}>
        <MetricTile metric="activationsTotal" value={String(stats.total)} />
        <MetricTile metric="activationsActive" value={String(stats.active)} />
        <MetricTile metric="activationsPending" value={String(activations.filter(a => a.status === "AWAITING_DRAFT" || a.status === "AWAITING_APPROVAL").length)} />
        <MetricTile metric="activationsComplete" value={String(activations.filter(a => a.status === "COMPLETE").length)} />
      </div>

      {activations.length === 0 ? (
        <EmptyState
          icon={<Zap size={32} color="var(--cc-text-subtle)" />} title="No activations yet"
          description="Activations will appear here once creators are assigned to campaigns."
          action={<Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setShowCreate(true)}>Add Activation</Button>}
        />
      ) : (
        <div style={{ overflowX: "auto", paddingBottom: 16 }}>
          <div style={{ display: "flex", gap: 16, minWidth: "max-content" }}>
            {COLUMNS.map((col) => {
              const items = grouped.get(col) ?? [];
              return (
                <div key={col} style={{ width: 280, minWidth: 200, display: "flex", flexDirection: "column", background: "var(--cc-bg)", borderRadius: 12, border: "1px solid var(--cc-border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 16px", borderBottom: "1px solid var(--cc-border)" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLUMN_COLORS[col], flexShrink: 0 }} />
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text)", flex: 1 }}>{COLUMN_LABELS[col]}</span>
                    <Badge variant="neutral" size="sm">{items.length}</Badge>
                  </div>

                  <div className="cc-stagger" style={{ flex: 1, padding: 8, display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", maxHeight: 500 }}>
                    {items.map((a) => {
                      const actions = NEXT_STATUS[a.status] ?? [];
                      return (
                        <div key={a.id} style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: "var(--cc-r-card, 8px)", padding: 12 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                            <Avatar name={a.creator.name} size="sm" />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p title={a.creator.name} style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.creator.name}</p>
                              <p style={{ fontSize: 11, color: "var(--cc-text-muted)", margin: 0 }}>@{stripAt(a.creator.handle)}</p>
                            </div>
                          </div>
                          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "0 0 8px" }}>{a.campaign.title}</p>
                          {actions.length > 0 && (
                            <div style={{ display: "flex", gap: 4 }}>
                              {actions.map(act => (
                                <button
                                  key={act.status}
                                  onClick={() => handleStatusChange(a.id, act.status)}
                                  style={{
                                    flex: 1, padding: "4px 8px", borderRadius: 6, fontSize: 11, fontWeight: 600,
                                    border: "1px solid var(--cc-border)", background: "var(--cc-card)",
                                    color: act.status === "DECLINED" ? "var(--cc-danger)" : "var(--cc-primary)",
                                    cursor: "pointer", transition: "all 0.15s",
                                  }}
                                >
                                  {act.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <Modal open onClose={() => setShowCreate(false)} title="Add Activation" size="md"
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button variant="primary" loading={creating} onClick={handleCreate}>Create</Button>
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label htmlFor="act-campaign" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Campaign *</label>
              <EntityPicker
                id="act-campaign"
                endpoint="/api/campaigns"
                placeholder="Search campaigns…"
                extract={(json) => json.campaigns.map((c: any) => ({ id: c.id, label: c.title }))}
                value={campaign}
                onChange={setCampaign}
              />
            </div>
            <div>
              <label htmlFor="act-creator" style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Creator *</label>
              <EntityPicker
                id="act-creator"
                endpoint="/api/creators"
                placeholder="Search creators…"
                extract={(json) =>
                  json.creators.map((c: any) => ({ id: c.id, label: c.name, hint: `@${stripAt(c.handle)}` }))
                }
                value={creator}
                onChange={setCreator}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
