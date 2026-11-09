"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ListChecks, Plus, XCircle, Zap } from "lucide-react";
import { EmptyState } from "@pratham7711/ui";
import { Modal } from "@/components/ds/Modal";
import {
  Button,
  DataTable,
  Dropdown,
  EntityPicker,
  Field,
  MetricTile,
  MoreMenu,
  PageHeader,
  SectionCard,
  StatusBadge,
  type DataTableColumn,
  type PickerOption,
} from "@/components/ds";
import { toast } from "sonner";
import { formatFull, stripAt } from "@/lib/format";
import { enumLabel } from "@/lib/ui/enumLabel";
import {
  ACTIVATION_QUEUES,
  ACTIVATION_STAGE_COUNTERS,
  groupByQueue,
  countByStatuses,
  namedStatusReachable,
} from "@/lib/activationQueues";
import DeliverablesModal from "./DeliverablesModal";
import { ACTIVATIONS_WIDTHS } from "./columns";
import { action } from "@/lib/ui/actions";
import CreatorAvatar from "@/components/creators/CreatorAvatar";

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

/* The forward step from each state. A row shows it as its one labelled
   button; the backward or destructive steps (Decline) go in the row's menu. */
const NEXT_STATUS: Record<string, { label: string; status: string; danger?: boolean }[]> = {
  AWAITING_DRAFT: [{ label: "Submit draft", status: "DRAFT_SUBMITTED" }],
  DRAFT_SUBMITTED: [{ label: "Review", status: "AWAITING_APPROVAL" }],
  AWAITING_APPROVAL: [{ label: "Approve", status: "APPROVED" }, { label: "Decline draft", status: "DECLINED", danger: true }],
  APPROVED: [{ label: "Start posting", status: "POSTING" }],
  POSTING: [{ label: "Mark posted", status: "POSTED" }],
  POSTED: [{ label: "Mark as complete", status: "COMPLETE" }],
  DECLINED: [{ label: "Re-open", status: "AWAITING_DRAFT" }],
};

/** The queue and stage names are written in Title Case where they are defined;
 *  every label on this screen reads in sentence case. */
function sentence(label: string): string {
  return label.charAt(0) + label.slice(1).toLowerCase();
}

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
  const columns: DataTableColumn<Activation>[] = [
    {
      key: "creator",
      header: "Creator",
      minWidth: 200,
      render: (a) => (
        <span style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <CreatorAvatar id={a.creator.id} name={a.creator.name} size="sm" />
          <span style={{ minWidth: 0 }}>
            <span className="cc-dt-truncate" style={{ fontWeight: "var(--cc-fw-medium)" }} title={a.creator.name}>
              {a.creator.name}
            </span>
            <span className="cc-dt-sub cc-dt-truncate">@{stripAt(a.creator.handle)}</span>
          </span>
        </span>
      ),
    },
    {
      key: "campaign",
      header: "Campaign",
      minWidth: 160,
      render: (a) => (
        <Link prefetch={false} href={`/campaigns/${a.campaign.id}`} title={a.campaign.title} className="cc-dt-primary cc-dt-truncate">
          {a.campaign.title}
        </Link>
      ),
    },
    {
      key: "status",
      header: "Status",
      width: statusDefs.length > 0 ? ACTIVATIONS_WIDTHS.statusNamed : ACTIVATIONS_WIDTHS.status,
      render: (a) => (
        <span style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {/* The org's own name for this state wins over the enum
              label, which is what makes "Invited" visible at all. */}
          <StatusBadge status={a.status}>{a.statusDefName ?? enumLabel(a.status)}</StatusBadge>
          {statusDefs.length > 0 && (
            <Dropdown
              ariaLabel={`Named status for ${a.creator.name}`}
              size="sm"
              value={a.statusDefId ?? ""}
              placeholder="Set status"
              align="left"
              minWidth={140}
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
        </span>
      ),
    },
    {
      /* updatedAt moves on any edit, notes and posted URL included, so this
         says "updated" rather than claiming a status change. */
      key: "updated",
      header: "Last updated",
      width: ACTIVATIONS_WIDTHS.updated,
      render: (a) => <span style={{ color: "var(--cc-text-muted)" }}>{relative(a.updatedAt)}</span>,
    },
    {
      key: "actions",
      header: "Actions",
      hideHeader: true,
      width: ACTIVATIONS_WIDTHS.actions,
      align: "right",
      render: (a) => {
        const steps = NEXT_STATUS[a.status] ?? [];
        const main = steps.find((s) => !s.danger);
        const rest = steps.filter((s) => s !== main);
        return (
          <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
            {main ? (
              <Button variant="secondary" size="sm" onClick={() => onStatusChange(a.id, main.status)}>
                {main.label}
              </Button>
            ) : null}
            <MoreMenu
              size="sm"
              label={`More actions for ${a.creator.name}`}
              items={[
                { label: "Manage deliverables", icon: <ListChecks size={16} aria-hidden="true" />, onClick: () => onManageDeliverables(a.id, a.creator.name) },
                ...rest.map((s) => ({
                  label: s.label,
                  danger: s.danger,
                  icon: s.danger ? <XCircle size={16} aria-hidden="true" /> : undefined,
                  onClick: () => onStatusChange(a.id, s.status),
                })),
              ]}
            />
          </span>
        );
      },
    },
  ];

  const title = `${sentence(label)} (${items.length})`;

  return (
    <SectionCard title={title} description={hint} padded={items.length === 0}>
      {items.length === 0 ? (
        <p style={{ margin: 0, fontSize: "var(--cc-t-14)", color: "var(--cc-text-muted)" }}>Nothing in this queue.</p>
      ) : (
        <DataTable
          bare
          caption={sentence(label)}
          columns={columns}
          rows={items}
          rowKey={(a) => a.id}
        />
      )}
    </SectionCard>
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
        toast.success(`Moved to ${enumLabel(status).toLowerCase()}`);
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
      <PageHeader
        /* Their h1 MEASURED 236.6px wide at 291,31 against our 136.2 -- it reads
           "Creator Activations", not "Activations". The rail label stays the
           short form on both sides. */
        title="Creator Activations"
        subtitle="Track creator deliverables and posts"
        actions={<Button variant="primary" iconLeft={<Plus size={16} aria-hidden="true" />} onClick={() => setShowCreate(true)} {...action("add-activation")}>Add activation</Button>}
      />

      {/* Seven counters, every one of them 0, stacked above "No activations
          yet" -- a wall of measurements of nothing, on the screen a new org
          sees first. A count only says something once there is something to
          count, so the tiles wait for the first row. /songs does the same with
          its search box. */}
      {activations.length > 0 && (
        <>
          <div className="cc-tiles-balanced" style={{ marginBottom: 12 }}>
            <MetricTile metric="activationsTotal" value={formatFull(stats.total)} />
            <MetricTile metric="activationsActive" value={formatFull(stats.active)} />
            <MetricTile metric="activationsComplete" value={formatFull(countByStatuses(activations, ["COMPLETE"]))} />
          </div>

          {/* The four stage counters: what is waiting, and on whom. These are
              counts of work outstanding, so Complete and Posted are in none of
              them -- a total that included terminal rows would not be
              actionable. Same tile as the row above, so the page has one KPI
              look instead of two. */}
          <div className="cc-tiles-balanced" style={{ marginBottom: 24 }}>
            {ACTIVATION_STAGE_COUNTERS.map((c) => (
              <MetricTile key={c.label} label={sentence(c.label)} value={formatFull(countByStatuses(activations, c.statuses))} />
            ))}
          </div>
        </>
      )}

      {activations.length === 0 ? (
        <EmptyState
          icon={<Zap size={32} color="var(--cc-text-subtle)" />} title="No activations yet"
          description="Activations will appear here once creators are assigned to campaigns."
          action={<Button variant="primary" iconLeft={<Plus size={16} aria-hidden="true" />} onClick={() => setShowCreate(true)}>Add activation</Button>}
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
        <Modal
          open
          onClose={() => setShowCreate(false)}
          icon={Zap}
          tone="brand"
          title="Add activation"
          description="Pair a creator with a campaign to track their deliverables and posts."
          size="md"
          dismissible={false}
          footer={
            <div className="cc-modal-footer">
              <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              {/* An add form waits for its required fields. */}
              <Button variant="primary" size="sm" loading={creating} disabled={!campaign || !creator} onClick={handleCreate}>Create</Button>
            </div>
          }
        >
          <div className="cc-dialog-stack">
            <Field label="Campaign" required>
              <EntityPicker
                id="act-campaign"
                endpoint="/api/campaigns"
                placeholder="Search campaigns"
                extract={(json) => json.campaigns.map((c: any) => ({ id: c.id, label: c.title }))}
                value={campaign}
                onChange={setCampaign}
              />
            </Field>
            <Field label="Creator" required>
              <EntityPicker
                id="act-creator"
                endpoint="/api/creators"
                placeholder="Search creators"
                extract={(json) =>
                  json.creators.map((c: any) => ({ id: c.id, label: c.name, hint: `@${stripAt(c.handle)}` }))
                }
                value={creator}
                onChange={setCreator}
              />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}
