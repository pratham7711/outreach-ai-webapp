"use client";
import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Users, ClipboardList, Share2, Copy, DollarSign, Archive } from "lucide-react";
import Link from "next/link";
import { Card, Badge, EmptyState, Skeleton, Input } from "@pratham7711/ui";
import { toast } from "sonner";
import { stripAt, formatDateAbs, formatFull } from "@/lib/format";
import { useConfirm, Button, PageHeader } from "@/components/ds";
import AddCreatorsDropdown from "@/components/lists/AddCreatorsDropdown";
import ListSharePanel from "@/components/lists/ListSharePanel";
import ExportMenu from "@/components/creators/ExportMenu";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import RateCardTable, { type RateCardItem } from "@/components/lists/RateCardTable";
import DuplicateListDialog from "@/components/lists/DuplicateListDialog";
import { LIST_STATUS_BADGE, LIST_STATUS_LABELS, type DecisionCounts, type ListStatus } from "@/lib/lists/approval";
import MetricFigure from "@/components/creators/MetricFigure";
import { avgViewsValue, followersValue } from "@/lib/creators/metricValue";
import { noun } from "@/lib/ui/noun";

type CreatorItem = {
  id: string;
  addedAt: string;
  creator: {
    id: string; name: string; handle: string; platform: string;
    followersCount: number; avgViews: number | null;
  };
};

type ListDetail = {
  id: string;
  name: string;
  description: string | null;
  items: CreatorItem[];
  _count: { items: number };
  /** Present once the list-approval tables exist: the page becomes a rate card. */
  approval?: { status: ListStatus; counts: DecisionCounts; isFavorite: boolean; archived: boolean };
};

function formatNumber(n: number) {
  return formatFull(n);
}

export default function ListDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const confirm = useConfirm();
  const [list, setList] = useState<ListDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [duplicating, setDuplicating] = useState(false);
  const [importing, setImporting] = useState(false);

  // Quiet refetches (a saved rate, a moved row) keep the table on screen
  // instead of dropping back to the skeleton.
  const fetchList = (quiet = false) => {
    if (!quiet) setLoading(true);
    fetch(`/api/lists/${id}`)
      .then(r => r.json())
      .then(data => setList(data.error ? null : data))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchList(); }, [id]);

  const handleRemoveCreator = async (itemId: string, creatorId: string) => {
    const ok = await confirm({
      title: "Remove this creator from the list?",
      description: "The creator stays in your roster — only their place on this list is removed.",
      confirmLabel: "Remove",
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/lists/${id}/creators/${creatorId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("Creator removed");
        fetchList();
      } else {
        toast.error("Failed to remove");
      }
    } catch { toast.error("Network error"); }
  };

  const handleImportRates = async () => {
    setImporting(true);
    try {
      const res = await fetch(`/api/lists/${id}/import-rates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json().catch(() => null);
      if (!res.ok) toast.error(data?.error ?? "Couldn't import rates");
      else {
        toast.success(
          data.imported
            ? `Filled ${data.imported} rate${data.imported === 1 ? "" : "s"} from the roster`
            : "No blank rates to fill from the roster",
        );
        fetchList(true);
      }
    } catch { toast.error("Network error"); }
    setImporting(false);
  };

  const handleArchive = async (archived: boolean) => {
    try {
      const res = await fetch(`/api/lists/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ archived }) });
      if (!res.ok) { toast.error("Couldn't update the list"); return; }
      toast.success(archived ? "List archived. The share link no longer takes decisions." : "List restored");
      fetchList(true);
    } catch { toast.error("Network error"); }
  };

  const handleDeleteList = async () => {
    if (deleting) return;
    const ok = await confirm({
      title: "Delete this entire list?",
      description:
        "The list and its ordering are deleted permanently. The creators on it stay in your roster. This cannot be undone.",
      confirmLabel: "Delete list",
    });
    if (!ok) return;
    // The DELETE plus the route change take a beat, and the button used to stay
    // live the whole time — a second click fired a second DELETE.
    setDeleting(true);
    try {
      const res = await fetch(`/api/lists/${id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success("List deleted");
        router.push("/lists");
        return;
      }
      toast.error("Failed to delete");
    } catch { toast.error("Network error"); }
    setDeleting(false);
  };

  if (loading) return (
    <div className="rsp-page" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <Skeleton width="120px" height="16px" />
      <Skeleton width="300px" height="32px" />
      <Skeleton width="100%" height="400px" borderRadius="12px" />
    </div>
  );

  if (!list) return (
    <div className="rsp-page">
      <EmptyState icon={<ClipboardList size={32} color="var(--cc-text-subtle)" />} title="List not found" />
    </div>
  );

  return (
    <div className="rsp-page">
      {/* No in-page trail: the top bar already reads Lists > <name>. */}

      {/* Header */}
      <PageHeader
        title={list.name}
        subtitle={list.description || undefined}
        meta={
          <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 8, fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
            <Users size={14} /> {list._count.items} {noun(list._count.items, "creator")}
            {list.approval && (
              <>
                <Badge variant={LIST_STATUS_BADGE[list.approval.status]}>{LIST_STATUS_LABELS[list.approval.status]}</Badge>
                <span style={{ whiteSpace: "nowrap" }}>
                  {list.approval.counts.approved} approved · {list.approval.counts.rejected} declined · {list.approval.counts.pending} pending
                </span>
              </>
            )}
          </div>
        }
        actions={
          /* Seven tools, not the reference's two-button header: "tool" keeps the
             secondaries out of CreatorCore's 180x40 action-slot box, so they stay
             the same size="sm" as Delete and Export beside them. */
          <>
            <Button variant="danger" size="sm" iconLeft={<Trash2 size={14} />} onClick={handleDeleteList} disabled={deleting}>
              {deleting ? "Deleting…" : "Delete List"}
            </Button>
            {list._count.items > 0 && (
              <ExportMenu
                align="down"
                items={[
                  { label: "Excel (.xlsx)", href: `/api/lists/${list.id}/export?format=xlsx` },
                  { label: "CSV", href: `/api/lists/${list.id}/export?format=csv` },
                ]}
              />
            )}
            {list.approval && (
              <Button variant="secondary" data-cc-slot="tool" size="sm" iconLeft={<Archive size={14} />} onClick={() => handleArchive(!list.approval!.archived)}>
                {list.approval.archived ? "Restore" : "Archive"}
              </Button>
            )}
            {list.approval && list.items.length > 0 && (
              <Button variant="secondary" data-cc-slot="tool" size="sm" iconLeft={<DollarSign size={14} />} onClick={handleImportRates} loading={importing}>
                Import rates
              </Button>
            )}
            {list.approval && list.items.length > 0 && (
              <Button variant="secondary" data-cc-slot="tool" size="sm" iconLeft={<Copy size={14} />} onClick={() => setDuplicating(true)}>
                Duplicate
              </Button>
            )}
            <Button variant="secondary" data-cc-slot="tool" size="sm" iconLeft={<Share2 size={14} />} onClick={() => setSharing(true)}>
              Share
            </Button>
            <AddCreatorsDropdown
              listId={list.id}
              onList={list.items.map((item) => item.creator.id)}
              onAdded={() => fetchList()}
            />
          </>
        }
      />

      {/* Creators table */}
      {list.items.length === 0 ? (
        <EmptyState icon={<Users size={32} color="var(--cc-text-subtle)" />} title="No creators in this list" description="Use Add Creators above to pick several from your roster at once." />
      ) : list.approval ? (
        <Card variant="solid" noPadding>
          <RateCardTable
            listId={list.id}
            items={list.items as unknown as RateCardItem[]}
            onChanged={() => fetchList(true)}
            onRemove={handleRemoveCreator}
          />
        </Card>
      ) : (
        <Card variant="solid" noPadding>
          <div className="rsp-table-wrap">
          <div style={{ minWidth: 640 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 100px 100px 60px", gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)" }}>
            {["Creator", "Platform", "Followers", "Avg Views", "Added", ""].map(h => (
              <span key={h} className="cc-microlabel">{h}</span>
            ))}
          </div>
          <div className="cc-stagger">
            {list.items.map((item, i) => (
              <div
                key={item.id}
                style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 100px 100px 60px", gap: 12, padding: "14px 24px", alignItems: "center", borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }}
                className="cc-table-row"
              >
                <Link prefetch={false} href={`/creators/${item.creator.id}`} style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: 12 }}>
                  <CreatorAvatar id={item.creator.id} name={item.creator.name} size="sm" />
                  <div>
                    <p style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{item.creator.name}</p>
                    <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>@{stripAt(item.creator.handle)}</p>
                  </div>
                </Link>
                <Badge variant="neutral">{item.creator.platform}</Badge>
                {/* "—" with the reason, never 0 or blank (plan A1): followersCount
                    defaults to 0 for a creator nobody has read. */}
                <span style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}><MetricFigure value={followersValue(item.creator.followersCount)} format={formatNumber} /></span>
                <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}><MetricFigure value={avgViewsValue(item.creator.avgViews)} format={formatNumber} /></span>
                <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>{formatDateAbs(item.addedAt)}</span>
                <button
                  onClick={() => handleRemoveCreator(item.id, item.creator.id)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", padding: 4 }}
                  title="Remove from list"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
          </div>
          </div>
        </Card>
      )}

      {sharing && <ListSharePanel listId={list.id} listName={list.name} onClose={() => setSharing(false)} />}
      {duplicating && list.approval && (
        <DuplicateListDialog
          listId={list.id}
          listName={list.name}
          approvedCount={list.approval.counts.approved}
          onClose={() => setDuplicating(false)}
        />
      )}
    </div>
  );
}
