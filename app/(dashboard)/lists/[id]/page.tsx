"use client";
import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Users, ClipboardList, Share2, Copy, DollarSign, Archive, ArchiveRestore, Download } from "lucide-react";
import { EmptyState } from "@pratham7711/ui";
import { NotFoundState } from "@/components/errors/NotFoundState";
import { toast } from "sonner";
import { formatDateAbs, formatFull } from "@/lib/format";
import { useConfirm, Button, DataTable, MoreMenu, PageHeader, PlatformTag, StatusBadge, type DataTableColumn } from "@/components/ds";
import { DataTableSkeleton, PageHeaderSkeleton } from "@/components/ui/PageSkeleton";
import AddCreatorsDropdown from "@/components/lists/AddCreatorsDropdown";
import ListSharePanel from "@/components/lists/ListSharePanel";
import RateCardTable, { ListCreatorCell, type RateCardItem } from "@/components/lists/RateCardTable";
import DuplicateListDialog from "@/components/lists/DuplicateListDialog";
import { LIST_STATUS_LABELS, type DecisionCounts, type ListStatus } from "@/lib/lists/approval";
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

function plainColumns(onRemove: (itemId: string, creatorId: string, name: string) => void): DataTableColumn<CreatorItem>[] {
  return [
    { key: "creator", header: "Creator", minWidth: 220, render: (item) => <ListCreatorCell creator={item.creator} /> },
    { key: "platform", header: "Platform", width: 136, render: (item) => <PlatformTag platform={item.creator.platform} /> },
    {
      key: "followers",
      header: "Followers",
      width: 120,
      align: "right",
      phone: true,
      /* "—" with the reason, never 0 or blank: followersCount defaults to 0
         for a creator nobody has read. */
      render: (item) => <MetricFigure value={followersValue(item.creator.followersCount)} format={formatNumber} />,
    },
    {
      key: "avgViews",
      header: "Avg. views",
      width: 120,
      align: "right",
      render: (item) => <MetricFigure value={avgViewsValue(item.creator.avgViews)} format={formatNumber} />,
    },
    { key: "added", header: "Added", width: 128, render: (item) => formatDateAbs(item.addedAt) },
    {
      key: "actions",
      header: "Actions",
      hideHeader: true,
      width: 64,
      render: (item) => (
        <MoreMenu
          size="sm"
          label={`More actions for ${item.creator.name}`}
          items={[
            {
              label: "Remove from list",
              icon: <Trash2 size={15} />,
              onClick: () => onRemove(item.id, item.creator.id, item.creator.name),
              danger: true,
            },
          ]}
        />
      ),
    },
  ];
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

  const handleRemoveCreator = async (_itemId: string, creatorId: string, name: string) => {
    const ok = await confirm({
      verb: "remove",
      subject: name,
      description: "They stay in your roster. Only their place on this list goes.",
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
    if (!list) return;
    const ok = await confirm({
      verb: "delete",
      subject: list.name,
      description: "The list and its order are deleted. The creators on it stay in your roster. This can't be undone.",
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
    <div className="rsp-page">
      <PageHeaderSkeleton />
      <DataTableSkeleton columns={[{}, { width: 112 }, { width: 112 }, { width: 128 }, { width: 64 }]} />
    </div>
  );

  if (!list) return (
    <div className="rsp-page">
      <NotFoundState
        icon={<ClipboardList size={32} />}
        title="List not found"
        description="This list doesn't exist or has been deleted."
        primary={{ href: "/lists", label: "Back to lists" }}
      />
    </div>
  );

  return (
    <div className="rsp-page">
      <PageHeader
        title={list.name}
        back={{ href: "/lists", label: "Lists" }}
        subtitle={list.description || undefined}
        badges={
          list.approval ? (
            /* "Awaiting client" is waiting on someone, which is the warning
               hue; the stored SHARED is not one of the shared status words. */
            <StatusBadge status={list.approval.status} tone={list.approval.status === "SHARED" ? "warning" : undefined} dot>
              {LIST_STATUS_LABELS[list.approval.status]}
            </StatusBadge>
          ) : undefined
        }
        meta={
          <>
            <span>
              <Users size={14} aria-hidden="true" />
              {list._count.items} {noun(list._count.items, "creator")}
            </span>
            {list.approval && (
              <>
                <span>{list.approval.counts.approved} approved</span>
                <span>{list.approval.counts.rejected} declined</span>
                <span>{list.approval.counts.pending} pending</span>
              </>
            )}
          </>
        }
        actions={
          <>
            <Button variant="secondary" iconLeft={<Share2 size={16} />} onClick={() => setSharing(true)}>
              Share
            </Button>
            <AddCreatorsDropdown
              listId={list.id}
              onList={list.items.map((item) => item.creator.id)}
              onAdded={() => fetchList()}
            />
            <MoreMenu
              label="More list actions"
              items={[
                ...(list._count.items > 0
                  ? [
                      { label: "Export as Excel (.xlsx)", icon: <Download size={15} />, href: `/api/lists/${list.id}/export?format=xlsx`, download: true },
                      { label: "Export as CSV", icon: <Download size={15} />, href: `/api/lists/${list.id}/export?format=csv`, download: true },
                    ]
                  : []),
                ...(list.approval && list.items.length > 0
                  ? [
                      { label: importing ? "Importing rates…" : "Import rates", icon: <DollarSign size={15} />, onClick: handleImportRates, disabled: importing, startsGroup: true },
                      { label: "Duplicate list", icon: <Copy size={15} />, onClick: () => setDuplicating(true) },
                    ]
                  : []),
                ...(list.approval
                  ? [
                      list.approval.archived
                        ? { label: "Restore list", icon: <ArchiveRestore size={15} />, onClick: () => handleArchive(false) }
                        : { label: "Archive list", icon: <Archive size={15} />, onClick: () => handleArchive(true) },
                    ]
                  : []),
                { label: deleting ? "Deleting…" : "Delete list", icon: <Trash2 size={15} />, onClick: handleDeleteList, disabled: deleting, danger: true },
              ]}
            />
          </>
        }
      />

      {list.items.length === 0 ? (
        <EmptyState icon={<Users size={32} color="var(--cc-text-subtle)" />} title="No creators in this list" description="Use Add creators above to pick several from your roster at once." />
      ) : list.approval ? (
        <RateCardTable
          listId={list.id}
          items={list.items as unknown as RateCardItem[]}
          onChanged={() => fetchList(true)}
          onRemove={handleRemoveCreator}
        />
      ) : (
        <DataTable
          className="cc-actions-table"
          phoneActions
          caption="Creators on this list"
          columns={plainColumns(handleRemoveCreator)}
          rows={list.items}
          rowKey={(item) => item.id}
          rowHref={(item) => `/creators/${item.creator.id}`}
        />
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
