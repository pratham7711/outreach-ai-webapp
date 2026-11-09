"use client";

import { useMemo, useState } from "react";
import { Mailbox } from "lucide-react";
import {
  DataTable,
  ListToolbar,
  MetricTile,
  NoResults,
  PageHeader,
  Pagination,
  type DataTableColumn,
} from "@/components/ds";
import type { Recipient, RecipientStats } from "@/lib/recipients/aggregate";
import { formatFull, stripAt } from "@/lib/format";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import { RECIPIENT_PAGE_SIZE, RECIPIENT_PAGE_SIZES, RECIPIENT_WIDTHS } from "./columns";

const METHOD_LABELS: Record<string, string> = {
  PAYPAL: "PayPal",
  BANK_TRANSFER: "Bank transfer",
  UPI: "UPI",
  NEFT: "NEFT",
  IMPS: "IMPS",
  RTGS: "RTGS",
  ENACH: "eNACH",
  WIRE: "Wire",
};

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatMethod(method: string) {
  return METHOD_LABELS[method] ?? method.replace(/_/g, " ").toLowerCase();
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  // UTC named, so the server render and the browser's cannot disagree. See lib/format.
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

const COLUMNS: DataTableColumn<Recipient>[] = [
  {
    key: "recipient",
    header: "Recipient",
    width: RECIPIENT_WIDTHS.recipient,
    minWidth: 220,
    render: (r) => (
      <div className="flex min-w-0 items-center gap-3">
        <CreatorAvatar id={r.creatorId} name={r.name} size="sm" />
        <span className="min-w-0">
          <span className="cc-dt-truncate font-medium" title={r.name}>
            {r.name}
          </span>
          <span className="cc-dt-sub">{r.handle ? `@${stripAt(r.handle)}` : r.paypalEmail ?? "—"}</span>
        </span>
      </div>
    ),
  },
  {
    key: "methods",
    header: "Methods",
    width: RECIPIENT_WIDTHS.methods,
    truncate: (r) => r.paymentMethods.map(formatMethod).join(", ") || undefined,
    render: (r) => (r.paymentMethods.length === 0 ? "—" : r.paymentMethods.map(formatMethod).join(", ")),
  },
  {
    key: "paid",
    header: "Total paid",
    align: "right",
    width: RECIPIENT_WIDTHS.paid,
    render: (r) => formatCurrency(r.totalPaid),
  },
  {
    key: "pending",
    header: "Pending",
    align: "right",
    width: RECIPIENT_WIDTHS.pending,
    render: (r) => (r.pending > 0 ? formatCurrency(r.pending) : "—"),
  },
  {
    key: "last",
    header: "Last paid",
    width: RECIPIENT_WIDTHS.last,
    render: (r) => formatDate(r.lastPayoutAt),
  },
  {
    key: "count",
    header: "Payouts",
    align: "right",
    width: RECIPIENT_WIDTHS.count,
    render: (r) => formatFull(r.payoutCount),
  },
];

export default function RecipientsClient({
  recipients,
  stats,
}: {
  recipients: Recipient[];
  stats: RecipientStats;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(RECIPIENT_PAGE_SIZE);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return recipients;
    return recipients.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.handle ?? "").toLowerCase().includes(q) ||
        (r.paypalEmail ?? "").toLowerCase().includes(q),
    );
  }, [recipients, search]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const shown = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="rsp-page page-enter">
      {/* The count lives in the table foot ("1–25 of 112"), not in the header. */}
      <PageHeader title="Recipients" subtitle="Everyone you've paid, with totals derived from payout history" />

      <div className="cc-tiles-balanced mb-6">
        <MetricTile metric="recipients" value={formatFull(stats.recipientCount)} />
        <MetricTile metric="totalPaid" value={formatCurrency(stats.totalPaid)} />
        <MetricTile metric="pendingPayouts" label="Pending" value={formatCurrency(stats.totalPending)} />
        <MetricTile metric="failedPayouts" value={formatCurrency(stats.totalFailed)} />
      </div>

      <ListToolbar
        search={{
          value: search,
          onChange: (v) => {
            setSearch(v);
            setPage(1);
          },
          placeholder: "Search recipients",
          ariaLabel: "Search recipients by name, handle or PayPal email",
        }}
      />

      <DataTable
        caption="Recipients"
        columns={COLUMNS}
        rows={shown}
        rowKey={(r) => r.creatorId}
        empty={
          search.trim() ? (
            <NoResults
              title="No recipients match"
              description="Nobody you've paid matches this search."
              onClear={() => setSearch("")}
              clearLabel="Clear search"
            />
          ) : (
            <NoResults
              icon={<Mailbox size={32} strokeWidth={1.75} />}
              title="No recipients yet"
              description="Recipients appear here once you've processed payouts to your creators."
            />
          )
        }
        footer={
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            total={filtered.length}
            pageSize={pageSize}
            onPageChange={setPage}
            pageSizeOptions={RECIPIENT_PAGE_SIZES}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(1);
            }}
          />
        }
      />
    </div>
  );
}
