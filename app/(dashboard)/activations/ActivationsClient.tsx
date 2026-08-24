"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Zap } from "lucide-react";
import { EmptyState, Card, Avatar, Modal } from "@pratham7711/ui";
import { MetricTile, EntityPicker, Button } from "@/components/ds";
import type { PickerOption } from "@/components/ds";
import { toast } from "sonner";
import { stripAt } from "@/lib/format";
import {
  ACTIVATION_QUEUES,
  ACTIVATION_STAGE_COUNTERS,
  ACTIVATION_STATUS_COLOR,
  ACTIVATION_STATUS_LABEL,
  groupByQueue,
  countByStatuses,
  namedStatusReachable,
} from "@/lib/activationQueues";
import { Dropdown } from "@/components/ds";
import DeliverablesModal from "./DeliverablesModal";

type StatusDef = { id: string; name: string; bucket: string };

type Activation = {
  id: string;
  status: string;
  /** The org's named status, when one has been chosen. */
  statusDefId: string | null;
  statusDefName: string | null;
  createdAt: string;
  updatedAt: string;
  creator: { id: string; name: string; handle: string; platform: string; avatarUrl: string | null };
  campaign: { id: string; title: string };
};

const NEXT_STATUS: Record<string, { label: string; status: string }[]> = {
  AWAITING_DRAFT: [{ label: "Submit Draft", status: "DRAFT_SUBMITTED" }],
  DRAFT_SUBMITTED: [{ label: "Review", status: "AWAITING_APPROVAL" }],
  AWAITING_APPROVAL: [{ label: "Approve", status: "APPROVED" }, { label: "Decline", status: "DECLINED" }],
  APPROVED: [{ label: "Start Posting", status: "POSTING" }],
  POSTING: [{ label: "Mark Posted", status: "POSTED" }],
  POSTED: [{ label: "Mark as Complete", status: "COMPLETE" }],
  DECLINED: [{ label: "Re-open", status: "AWAITING_DRAFT" }],
};

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months < 12 ? `${months}mo ago` : `${Math.floor(months / 12)}y ago`;
}

// Creator · Last Update · Campaign · Status & Actions, as the reference has it.
const QUEUE_GRID = "minmax(200px, 1.4fr) 120px minmax(160px, 1fr) minmax(220px, auto)";

function QueueSection({
  label,
  hint,
  items,
  onStatusChange,
  statusDefs,
  onNamedStatusChange,
  onManageDeliverables,
}: {
  label: string;
  hint: string;
  items: Activation[];
  onStatusChange: (id: string, status: string) => void;
  statusDefs: StatusDef[];
  onNamedStatusChange: (id: string, statusDefId: string | null) => void;
  onManageDeliverables: (id: string, creatorName: string) => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>
          {label} ({items.length})
        </span>
        <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{hint}</span>
      </div>

      {items.length === 0 ? (
        <Card variant="outlined" style={{ padding: 16 }}>
          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>Nothing in this queue.</span>
        </Card>
      ) : (
        <Card variant="outlined" style={{ padding: 0, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <div style={{ minWidth: 760 }}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: QUEUE_GRID,
                  gap: 12,
                  padding: "10px 16px",
                  borderBottom: "1px solid var(--cc-border)",
                  background: "var(--cc-bg)",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.04em",
                  color: "var(--cc-text-muted)",
                }}
              >
                <span>CREATOR</span>
                <span>LAST UPDATE</span>
                <span>CAMPAIGN</span>
                <span>STATUS &amp; ACTIONS</span>
              </div>

              {items.map((a) => {
                const actions = NEXT_STATUS[a.status] ?? [];
                return (
                  <div
                    key={a.id}
                    style={{
                      display: "grid",
                      gridTemplateColumns: QUEUE_GRID,
                      gap: 12,
                      padding: "12px 16px",
                      borderBottom: "1px solid var(--cc-border)",
                      alignItems: "center",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                      <Avatar name={a.creator.name} size="sm" src={a.creator.avatarUrl ?? undefined} />
                      <div style={{ minWidth: 0 }}>
                        <div title={a.creator.name} style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {a.creator.name}
                        </div>
                        <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>@{stripAt(a.creator.handle)}</div>
                      </div>
                    </div>

                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{relative(a.updatedAt)}</span>

                    <Link
                      prefetch={false}
                      href={`/campaigns/${a.campaign.id}`}
                      title={a.campaign.title}
                      style={{ fontSize: 13, color: "var(--cc-text)", textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                    >
                      {a.campaign.title}
                    </Link>

                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--cc-text-muted)" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: ACTIVATION_STATUS_COLOR[a.status] ?? "var(--cc-text-subtle)" }} />
                        {/* The org's own name for this state wins over the enum
                            label, which is what makes "Invited" visible at all. */}
                        {a.statusDefName ?? ACTIVATION_STATUS_LABEL[a.status] ?? a.status}
                      </span>
                      {statusDefs.length > 0 && (
                        <Dropdown
                          ariaLabel={`Named status for ${a.creator.name}`}
                          value={a.statusDefId ?? ""}
                          placeholder="Set status"
                          align="left"
                          minWidth={150}
                          onChange={(v) => onNamedStatusChange(a.id, v === "" ? null : v)}
                          options={[
                            { value: "", label: "No named status" },
                            // Only what the state machine allows from here: a
                            // dropdown whose options 400 is worse than none.
                            ...statusDefs
                              .filter((d) => namedStatusReachable(a.status, d.bucket))
                              .map((d) => ({ value: d.id, label: d.name })),
                          ]}
                        />
                      )}
                      <button
                        onClick={() => onManageDeliverables(a.id, a.creator.name)}
                        style={{
                          padding: "5px 10px",
                          borderRadius: 6,
                          fontSize: 12,
                          fontWeight: 600,
                          border: "1px solid var(--cc-border)",
                          background: "var(--cc-card)",
                          color: "var(--cc-text)",
                          cursor: "pointer",
                        }}
                      >
                        Manage Deliverables
                      </button>
                      {actions.map((act) => (
                        <button
                          key={act.status}
                          onClick={() => onStatusChange(a.id, act.status)}
                          style={{
                            padding: "5px 10px",
                            borderRadius: 6,
                            fontSize: 12,
                            fontWeight: 600,
                            border: "1px solid var(--cc-border)",
                            background: "var(--cc-card)",
                            color: act.status === "DECLINED" ? "var(--cc-danger)" : "var(--cc-primary)",
                            cursor: "pointer",
                          }}
                        >
                          {act.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function ActivationsClient({ activations, stats, statusDefs }: {
  activations: Activation[];
  stats: { total: number; active: number };
  statusDefs: StatusDef[];
}) {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [managing, setManaging] = useState<{ id: string; creatorName: string } | null>(null);
  const [campaign, setCampaign] = useState<PickerOption | null>(null);
  const [creator, setCreator] = useState<PickerOption | null>(null);
  const [creating, setCreating] = useState(false);

  const { groups, ungrouped } = groupByQueue(activations);

  const handleStatusChange = async (id: string, status: string) => {
    try {
      const res = await fetch(`/api/activations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast.success(`Moved to ${ACTIVATION_STATUS_LABEL[status]}`);
        router.refresh();
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed");
      }
    } catch { toast.error("Network error"); }
  };

  /**
   * Choosing one of the org's named statuses. The route moves the enum bucket
   * along with it, so the queues and every status filter keep working on a name
   * they have never heard of.
   */
  const handleNamedStatusChange = async (id: string, statusDefId: string | null) => {
    try {
      const res = await fetch(`/api/activations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statusDefId }),
      });
      if (res.ok) {
        const name = statusDefs.find((d) => d.id === statusDefId)?.name;
        toast.success(name ? `Status set to ${name}` : "Named status cleared");
        router.refresh();
      } else {
        const err = await res.json().catch(() => ({}));
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
      <div className="rsp-grid-tiles" style={{ marginBottom: 20 }}>
        <MetricTile metric="activationsTotal" value={String(stats.total)} />
        <MetricTile metric="activationsActive" value={String(stats.active)} />
        <MetricTile metric="activationsComplete" value={String(countByStatuses(activations, ["COMPLETE"]))} />
      </div>

      {/* The reference's four stage counters: what is waiting, and on whom. These
          are counts of work outstanding, so Complete and Posted are in none of
          them — a total that included terminal rows would not be actionable. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 28 }}>
        {ACTIVATION_STAGE_COUNTERS.map((c) => (
          <div
            key={c.label}
            style={{
              background: "var(--cc-card)",
              border: "1px solid var(--cc-border)",
              borderRadius: 10,
              padding: "10px 14px",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              minWidth: 150,
            }}
          >
            <span style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>{c.label}</span>
            <span style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)", fontVariantNumeric: "tabular-nums" }}>
              {countByStatuses(activations, c.statuses)}
            </span>
          </div>
        ))}
      </div>

      {activations.length === 0 ? (
        <EmptyState
          icon={<Zap size={32} color="var(--cc-text-subtle)" />} title="No activations yet"
          description="Activations will appear here once creators are assigned to campaigns."
          action={<Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setShowCreate(true)}>Add Activation</Button>}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {ACTIVATION_QUEUES.map((queue) => {
            const items = groups.get(queue.key) ?? [];
            return (
              <QueueSection
                key={queue.key}
                label={queue.label}
                hint={queue.hint}
                items={items}
                onStatusChange={handleStatusChange}
                onManageDeliverables={(id, creatorName) => setManaging({ id, creatorName })}
                statusDefs={statusDefs}
                onNamedStatusChange={handleNamedStatusChange}
              />
            );
          })}
          {/* A status in the enum but in no queue would otherwise vanish from the
              page entirely. Showing it is how we find out. */}
          {ungrouped.length > 0 && (
            <QueueSection
              label="Unrecognised status"
              hint="These are not in any queue — the queue definitions need updating"
              items={ungrouped}
              onStatusChange={handleStatusChange}
              onManageDeliverables={(id, creatorName) => setManaging({ id, creatorName })}
              statusDefs={statusDefs}
              onNamedStatusChange={handleNamedStatusChange}
            />
          )}
        </div>
      )}

      {managing && (
        <DeliverablesModal
          activationId={managing.id}
          creatorName={managing.creatorName}
          onClose={() => setManaging(null)}
          onChanged={() => router.refresh()}
        />
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
