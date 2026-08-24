"use client";

import { useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, ArrowRight, Check, Banknote, Download } from "lucide-react";
import { Card, Badge, EmptyState, Input, Avatar } from "@pratham7711/ui";
import { MetricTile, useConfirm, Button } from "@/components/ds";
import { StatusTabs } from "@/components/ds";
import { toast } from "sonner";
import AddPayoutModal from "@/components/modals/AddPayoutModal";
import PayoutDetailModal from "@/components/modals/PayoutDetailModal";
import { stripAt, formatDateAbs } from "@/lib/format";
import { downloadCsv, exportStamp } from "@/lib/csv";

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

type Creator = { id: string; name: string; handle: string };
type Campaign = { id: string; title: string };

const STATUS_BADGE_VARIANT: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  PROCESSING: "neutral",
  SUCCESS: "success",
  FAILED: "danger",
};

const STATUS_TABS = ["All", "Pending", "Processing", "Success", "Failed"];

const QUICK_ACTIONS: Record<string, { label: ReactNode; status: string }[]> = {
  PENDING: [
    { label: "Mark Paid", status: "SUCCESS" },
    { label: <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ArrowRight size={14} /> Processing</span>, status: "PROCESSING" },
  ],
  PROCESSING: [{ label: <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><ArrowRight size={14} /> Success</span>, status: "SUCCESS" }],
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function PayoutsClient({ payouts, stats }: {
  payouts: Payout[];
  stats: { total: number; sent: number; pending: number; processing: number; failed: number };
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

  return (
    <div className="rsp-page page-enter">
      {/* Header */}
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Payouts
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            Track and manage creator payments
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Button
            variant="secondary"
            iconLeft={<Download size={15} />}
            size="sm"
            disabled={filtered.length === 0}
            onClick={exportData}
          >
            Export Data
          </Button>
          <Button variant="primary" iconLeft={<Plus size={15} />} size="sm" onClick={() => setShowModal(true)}>
            New Payout
          </Button>
        </div>
      </div>

      {/* Stats */}
      <style>{`
        .payout-tiles { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
        @media (min-width: 640px) { .payout-tiles { gap: 16px; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); } }
        .payout-tiles .ui-statcard { min-width: 0; }
        .payout-tiles .ui-statcard-value { overflow-wrap: anywhere; font-size: clamp(17px, 5vw, 30px); }
        .payout-inner { min-width: 780px; }
        .payout-head, .payout-row { display: grid; grid-template-columns: 40px 1fr 140px 100px 100px 120px 160px; gap: 12px; align-items: center; }
        .payout-head { padding: 12px 24px; border-bottom: 1px solid var(--cc-border); background: var(--cc-bg); }
        .payout-row { padding: 14px 24px; }
        @media (max-width: 767px) {
          .payout-inner { min-width: 0; }
          .payout-head { display: none; }
          .payout-row { display: flex; flex-wrap: wrap; align-items: center; column-gap: 12px; row-gap: 8px; padding: 14px 16px; }
          .payout-row > [data-col="creator"] { order: 1; flex: 1 1 auto; min-width: 0; }
          .payout-row > [data-col="amount"] { order: 2; margin-left: auto; }
          .payout-row > [data-col="campaign"] { order: 3; flex-basis: 100%; }
          .payout-row > [data-col="status"] { order: 4; }
          .payout-row > [data-col="date"] { order: 5; margin-left: auto; }
          .payout-row > [data-col="action"] { order: 6; flex-basis: 100%; }
        }
      `}</style>
      <div className="cc-stagger payout-tiles" style={{ marginBottom: 32 }}>
        <MetricTile metric="totalPaid" value={formatCurrency(stats.sent)} />
        <MetricTile metric="pendingPayouts" value={formatCurrency(stats.pending)} />
        <MetricTile metric="processingPayouts" value={formatCurrency(stats.processing)} />
        <MetricTile metric="failedPayouts" value={formatCurrency(stats.failed)} />
      </div>

      {/* Search + Status Filter */}
      <div style={{ marginBottom: 24, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Transactions"
            iconLeft={<Search size={16} />}
          />
        </div>
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
      </div>

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div style={{
          marginBottom: 16, padding: "10px 16px", background: "var(--cc-primary)", borderRadius: 10,
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap",
        }}>
          <span style={{ color: "white", fontSize: 13, fontWeight: 600 }}>
            {selected.size} selected
          </span>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Button size="sm" variant="secondary" onClick={() => handleBulkAction("PROCESSING")}>
              Mark Processing
            </Button>
            <Button size="sm" variant="secondary" onClick={() => handleBulkAction("SUCCESS")}>
              Mark Success
            </Button>
            <Button size="sm" variant="secondary" onClick={() => handleBulkAction("FAILED")}>
              Mark Failed
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <Card variant="solid" noPadding>
        {filtered.length === 0 ? (
          <div style={{ padding: "48px 24px" }}>
            <EmptyState
              icon={<Banknote size={32} color="var(--cc-text-subtle)" />}
              title="No payouts yet"
              description="Process your first creator payment to get started"
              action={
                <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowModal(true)}>
                  New Payout
                </Button>
              }
            />
          </div>
        ) : (
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <div className="payout-inner">
            {/* Table header */}
            <div className="payout-head">
              {/* Same reasoning as the per-row box below: the label takes the
                  cell so the target is finger-sized without resizing the box. */}
              <label style={{ display: "flex", alignItems: "center", width: "100%", height: "100%", minHeight: 32, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  aria-label="Select all payouts"
                  checked={selected.size === filtered.length && filtered.length > 0}
                  onChange={toggleAll}
                  style={{ accentColor: "var(--cc-primary)", width: 16, height: 16 }}
                />
              </label>
              {["Creator", "Campaign", "Amount", "Status", "Date", "Action"].map((h) => (
                <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
              ))}
            </div>
            <div className="cc-stagger">
              {filtered.map((p, i) => (
                <div
                  key={p.id}
                  className="cc-table-row payout-row"
                  style={{
                    borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                    cursor: "pointer",
                    background: selected.has(p.id) ? "var(--cc-bg)" : undefined,
                  }}
                  onClick={() => setDetailPayout(p)}
                >
                  {/* Checkbox. A bare input is 13x13, which is a quarter of the
                      44px a finger needs and was the smallest thing on the page
                      by area. The box keeps its size -- the label around it
                      takes the whole cell, which is already row-height, so the
                      tap area grows and the layout does not move. */}
                  <label
                    data-col="check"
                    style={{
                      display: "flex", alignItems: "center",
                      width: "100%", height: "100%", minHeight: 32,
                      cursor: "pointer",
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select payout for ${p.creator.name}`}
                      checked={selected.has(p.id)}
                      onChange={() => toggleSelect(p.id)}
                      style={{ accentColor: "var(--cc-primary)", width: 16, height: 16 }}
                    />
                  </label>
                  {/* Creator — keyboard-accessible entry point to the detail view */}
                  <button
                    type="button"
                    data-col="creator"
                    onClick={(e) => { e.stopPropagation(); setDetailPayout(p); }}
                    aria-label={`View payout details for ${p.creator.name}`}
                    style={{ display: "flex", alignItems: "center", gap: 12, background: "none", border: "none", padding: 0, cursor: "pointer", textAlign: "left", font: "inherit", minWidth: 0 }}
                  >
                    <Avatar name={p.creator.name} size="sm" />
                    <div style={{ minWidth: 0 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{p.creator.name}</p>
                      <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{stripAt(p.creator.handle)}</p>
                    </div>
                  </button>
                  {/* Campaign */}
                  <span data-col="campaign" style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{p.campaign?.title ?? "—"}</span>
                  {/* Amount */}
                  <span data-col="amount" style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)" }}>{formatCurrency(p.amount)}</span>
                  {/* Status */}
                  <div data-col="status">
                    <Badge variant={STATUS_BADGE_VARIANT[p.status] ?? "neutral"} dot>
                      {p.status}
                    </Badge>
                  </div>
                  {/* Date */}
                  <span data-col="date" style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{formatDateAbs(p.createdAt)}</span>
                  {/* Quick action */}
                  <div data-col="action" onClick={(e) => e.stopPropagation()}>
                    {(QUICK_ACTIONS[p.status] ?? []).length > 0 ? (
                      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                        {(QUICK_ACTIONS[p.status] ?? []).map((action) => (
                          <Button
                            key={action.status}
                            size="sm"
                            variant={action.label === "Mark Paid" ? "primary" : "secondary"}
                            disabled={transitioning.has(p.id)}
                            onClick={() => handleStatusChange(p.id, action.status)}
                          >
                            {transitioning.has(p.id) ? "..." : action.label}
                          </Button>
                        ))}
                      </div>
                    ) : p.status === "SUCCESS" ? (
                      <span style={{ fontSize: 12, color: "var(--cc-success)", fontWeight: 600 }}>
                        <Check size={14} style={{ display: "inline", verticalAlign: "middle" }} /> Done
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
            </div>
          </div>
        )}
      </Card>

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
