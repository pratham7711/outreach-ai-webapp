"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Banknote, Download } from "lucide-react";
import {
  Button,
  DataTable,
  ListToolbar,
  MetricTile,
  MoreMenu,
  NoResults,
  PageHeader,
  StatusBadge,
  StatusTabs,
  useConfirm,
  type DataTableColumn,
} from "@/components/ds";
import { toast } from "sonner";
import AddPayoutModal from "@/components/modals/AddPayoutModal";
import PayoutDetailModal from "@/components/modals/PayoutDetailModal";
import { stripAt, formatDateAbs, formatFull } from "@/lib/format";
import { downloadCsv, exportStamp } from "@/lib/csv";
import type { PayoutCurrencyTotals } from "@/lib/payouts/totals";
import { action } from "@/lib/ui/actions";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import { PAYOUT_WIDTHS } from "./columns";

type Payout = {
  id: string;
  amount: number;
  currency: string;
  status: string;
  paymentMethod: string;
  recipientPaypalEmail: string | null;
  transactionId: string | null;
  failureReason: string | null;
  createdAt: string;
  initiatedAt: string;
  completedAt: string | null;
  creator: { id: string; name: string; handle: string; platform: string };
  campaign: { id: string; title: string } | null;
};

const STATUS_TABS = ["All", "Pending", "Processing", "Success", "Failed"];

/* The status changes a row offers. The first is the row's one labelled button;
   the rest sit in its ⋯ menu beside "View payout details". */
const NEXT_STATUS: Record<string, { label: string; status: string }[]> = {
  PENDING: [
    { label: "Mark paid", status: "SUCCESS" },
    { label: "Mark processing", status: "PROCESSING" },
  ],
  PROCESSING: [{ label: "Mark paid", status: "SUCCESS" }],
};

/* The payout's own currency, never a blanket "USD". Every row carries one, the
   CSV export has always written it, and POST /api/payouts accepts four of them,
   so formatting a GBP payout as $1,200.00 restates it as a different amount of
   money. */
function formatCurrency(n: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

/**
 * A KPI tile's figure.
 *
 * One currency in the org's payouts and it reads exactly as it always did — one
 * line, one number. Several, and it becomes one line per currency, because
 * there is no honest single number to print: the four tiles used to sum
 * `_sum.amount` across every currency at once and stamp a dollar sign on the
 * result. A currency contributing nothing to this particular status is dropped
 * from that tile rather than printed as a zero.
 */
function TileValue({
  rows,
  pick,
}: {
  rows: PayoutCurrencyTotals[];
  pick: (row: PayoutCurrencyTotals) => number;
}) {
  if (rows.length <= 1) {
    const row = rows[0];
    return <>{formatCurrency(row ? pick(row) : 0, row?.currency ?? "USD")}</>;
  }
  const contributing = rows.filter((row) => pick(row) !== 0);
  // Nothing at all in this status still needs a figure, so the leading currency
  // (rows is sorted by total) shows its zero.
  const shown = contributing.length > 0 ? contributing : rows.slice(0, 1);
  return (
    <span className="flex flex-col">
      {shown.map((row) => (
        <span key={row.currency}>{formatCurrency(pick(row), row.currency)}</span>
      ))}
    </span>
  );
}

export default function PayoutsClient({ payouts, stats }: {
  payouts: Payout[];
  /** One entry per currency the org has payouts in, highest total first. */
  stats: PayoutCurrencyTotals[];
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [showModal, setShowModal] = useState(false);
  const [detailPayout, setDetailPayout] = useState<Payout | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [transitioning, setTransitioning] = useState<Set<string>>(new Set());

  const filtered = payouts.filter((p) => {
    const matchSearch =
      p.creator.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.campaign?.title ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      statusFilter === "All" || p.status.toUpperCase() === statusFilter.toUpperCase();
    return matchSearch && matchStatus;
  });
  const isFiltered = search.trim() !== "" || statusFilter !== "All";
  const stackFit = stats.length > 1 ? 13 : undefined;
  const clearFilters = () => {
    setSearch("");
    setStatusFilter("All");
  };

  // Exports what is on screen, not the whole table: someone who has narrowed
  // to the failed payouts for one creator wants those rows, and a file that
  // silently ignored the filter would be the wrong answer twice over.
  const exportData = () => {
    downloadCsv(`payouts-${exportStamp()}`, [
      ["Date", "Creator", "Handle", "Campaign", "Amount", "Currency", "Status",
       "Method", "Recipient", "Transaction ID", "Completed", "Failure Reason"],
      ...filtered.map((p) => [
        formatDateAbs(p.initiatedAt),
        p.creator.name,
        p.creator.handle,
        p.campaign?.title ?? "",
        p.amount,
        p.currency,
        p.status,
        p.paymentMethod,
        p.recipientPaypalEmail ?? "",
        p.transactionId ?? "",
        p.completedAt ? formatDateAbs(p.completedAt) : "",
        p.failureReason ?? "",
      ]),
    ]);
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = filtered.length > 0 && selected.size === filtered.length;
  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((p) => p.id)));
    }
  };

  const handleStatusChange = async (id: string, status: string) => {
    const ok = await confirm({
      title: `Change status to ${status.toLowerCase()}?`,
      description: "This updates the payout record for everyone in your organisation.",
      confirmLabel: "Change status",
      tone: "default",
    });
    if (!ok) return;
    setTransitioning((prev) => new Set(prev).add(id));
    try {
      const res = await fetch(`/api/payouts/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        toast.success(`Payout marked as ${status}`);
        router.refresh();
        setDetailPayout(null);
      } else {
        const err = await res.json();
        toast.error(err.error || "Failed to update");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setTransitioning((prev) => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const handleBulkAction = async (status: string) => {
    const ids = Array.from(selected);
    const ok = await confirm({
      title: `Update ${ids.length} ${ids.length === 1 ? "payout" : "payouts"}?`,
      description: `All ${ids.length} selected ${ids.length === 1 ? "payout" : "payouts"} will be set to ${status.toLowerCase()}.`,
      confirmLabel: "Update all",
      tone: "default",
    });
    if (!ok) return;
    try {
      const res = await fetch("/api/payouts/bulk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, status }),
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Updated ${data.updated} payouts`);
        if (data.errors?.length) toast.warning(`${data.errors.length} could not be updated`);
        setSelected(new Set());
        router.refresh();
      } else {
        toast.error("Bulk update failed");
      }
    } catch {
      toast.error("Network error");
    }
  };

  /* The checkbox shares the creator's cell rather than taking a column of its
     own: on a phone the table pins its first column while the rest scroll, and
     a pinned checkbox with the name scrolled away identifies nothing. The name
     is a button because a payout opens in a dialog, not on a page of its own. */
  const columns: DataTableColumn<Payout>[] = [
    {
      key: "creator",
      header: "Creator",
      width: PAYOUT_WIDTHS.creator,
      minWidth: 240,
      render: (p) => (
        <div className="flex min-w-0 items-center gap-3">
          <label className="flex min-h-8 shrink-0 cursor-pointer items-center">
            <input
              type="checkbox"
              className="size-4 cursor-pointer accent-[var(--cc-primary)]"
              aria-label={`Select payout for ${p.creator.name}`}
              checked={selected.has(p.id)}
              onChange={() => toggleSelect(p.id)}
            />
          </label>
          <CreatorAvatar id={p.creator.id} name={p.creator.name} size="sm" />
          <span className="min-w-0">
            <button
              type="button"
              className="cc-dt-primary block max-w-full cursor-pointer truncate text-left"
              title={p.creator.name}
              onClick={() => setDetailPayout(p)}
            >
              <span className="sr-only">View payout details for </span>
              {p.creator.name}
            </button>
            <span className="cc-dt-sub">@{stripAt(p.creator.handle)}</span>
          </span>
        </div>
      ),
    },
    {
      key: "campaign",
      header: "Campaign",
      width: PAYOUT_WIDTHS.campaign,
      minWidth: 180,
      truncate: (p) => p.campaign?.title,
      render: (p) => p.campaign?.title ?? "—",
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      width: PAYOUT_WIDTHS.amount,
      render: (p) => formatCurrency(p.amount, p.currency),
    },
    {
      key: "status",
      header: "Status",
      width: PAYOUT_WIDTHS.status,
      render: (p) => <StatusBadge status={p.status} />,
    },
    {
      key: "date",
      header: "Date",
      width: PAYOUT_WIDTHS.date,
      render: (p) => formatDateAbs(p.createdAt),
    },
    {
      key: "actions",
      header: "Actions",
      hideHeader: true,
      align: "right",
      width: PAYOUT_WIDTHS.actions,
      render: (p) => {
        const [main, ...rest] = NEXT_STATUS[p.status] ?? [];
        const busy = transitioning.has(p.id);
        return (
          <div className="flex items-center justify-end gap-2">
            {main ? (
              <Button size="sm" variant="secondary" loading={busy} onClick={() => handleStatusChange(p.id, main.status)}>
                {main.label}
              </Button>
            ) : null}
            <MoreMenu
              size="sm"
              label={`More actions for the payout to ${p.creator.name}`}
              items={[
                { label: "View payout details", onClick: () => setDetailPayout(p) },
                ...rest.map((a) => ({
                  label: a.label,
                  disabled: busy,
                  onClick: () => handleStatusChange(p.id, a.status),
                })),
              ]}
            />
          </div>
        );
      },
    },
  ];

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Payouts"
        subtitle="Track and manage creator payments"
        actions={
          <>
            <Button
              variant="secondary"
              iconLeft={<Download size={16} aria-hidden="true" />}
              disabled={filtered.length === 0}
              onClick={exportData}
              {...action("export-data")}
            >
              Export CSV
            </Button>
            <Button variant="primary" iconLeft={<Plus size={16} aria-hidden="true" />} onClick={() => setShowModal(true)}>
              New payout
            </Button>
          </>
        }
        tabs={
          <StatusTabs
            ariaLabel="Filter payouts by status"
            tabs={STATUS_TABS.map((s) => ({
              key: s,
              label: s,
              count: s === "All" ? payouts.length : payouts.filter((p) => p.status.toUpperCase() === s.toUpperCase()).length,
            }))}
            active={statusFilter}
            onChange={setStatusFilter}
          />
        }
      />

      {/* A tile holding one line per currency takes the smaller figure size,
          so a four-currency stack fits the box one figure uses. */}
      <div className="cc-tiles-balanced mb-6">
        <MetricTile metric="totalPaid" fitTo={stackFit} value={<TileValue rows={stats} pick={(r) => r.sent} />} />
        <MetricTile metric="pendingPayouts" fitTo={stackFit} value={<TileValue rows={stats} pick={(r) => r.pending} />} />
        <MetricTile metric="processingPayouts" fitTo={stackFit} value={<TileValue rows={stats} pick={(r) => r.processing} />} />
        <MetricTile metric="failedPayouts" fitTo={stackFit} value={<TileValue rows={stats} pick={(r) => r.failed} />} />
      </div>

      {/* With rows picked, the bulk changes take the toolbar's right side: the
          common one labelled, the rest in ⋯. Select all stays beside them. */}
      <ListToolbar
        search={{
          value: search,
          onChange: setSearch,
          placeholder: "Search payouts",
          ariaLabel: "Search payouts by creator or campaign",
        }}
        end={
          filtered.length > 0 ? (
            <>
              {selected.size > 0 ? (
                <>
                  <span className="text-sm font-medium text-[var(--cc-text)]" aria-live="polite">
                    {formatFull(selected.size)} selected
                  </span>
                  <Button variant="secondary" onClick={() => handleBulkAction("SUCCESS")}>
                    Mark paid
                  </Button>
                  <MoreMenu
                    label="More actions for the selected payouts"
                    items={[
                      { label: "Mark processing", onClick: () => handleBulkAction("PROCESSING") },
                      { label: "Mark failed", onClick: () => handleBulkAction("FAILED") },
                      { label: "Clear selection", startsGroup: true, onClick: () => setSelected(new Set()) },
                    ]}
                  />
                </>
              ) : null}
              <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[var(--cc-text)]">
                <input
                  type="checkbox"
                  className="size-4 cursor-pointer accent-[var(--cc-primary)]"
                  checked={allSelected}
                  onChange={toggleAll}
                />
                Select all
              </label>
            </>
          ) : null
        }
      />

      <DataTable
        caption="Payouts"
        columns={columns}
        rows={filtered}
        rowKey={(p) => p.id}
        empty={
          isFiltered ? (
            <NoResults
              title="No payouts match"
              description="Nothing matches this search and status."
              onClear={clearFilters}
            />
          ) : (
            <NoResults
              icon={<Banknote size={32} strokeWidth={1.75} />}
              title="No payouts yet"
              description="Process your first creator payment with New payout."
            />
          )
        }
      />

      {showModal && <AddPayoutModal onClose={() => setShowModal(false)} />}
      {detailPayout && (
        <PayoutDetailModal
          payout={detailPayout}
          onClose={() => setDetailPayout(null)}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
