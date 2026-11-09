"use client";
import { useState, useEffect, useCallback } from "react";
import {
  Button,
  DataTable,
  ListToolbar,
  LoadError,
  MetricTile,
  NoResults,
  PageHeader,
  Pagination,
  StatusBadge,
  StatusTabs,
  type DataTableColumn,
} from "@/components/ds";
import { TileGridSkeleton } from "@/components/ui/PageSkeleton";
import { formatDateAbs, formatFull } from "@/lib/format";
import { Inbox, Download } from "lucide-react";
import { downloadCsv, exportStamp } from "@/lib/csv";
import { formatMoney, formatRowsByCurrency } from "@/lib/money";
import { toast } from "sonner";
import { action } from "@/lib/ui/actions";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import CreatorName from "@/components/creators/CreatorName";
import { REQUEST_PAGE_SIZE, REQUEST_PAGE_SIZES, REQUEST_WIDTHS } from "./columns";

/**
 * Mirrors what `GET /api/payout-requests` actually returns.
 *
 * It returns flat fields under a `payoutRequests` key; this page read
 * `data.requests` and reached for nested `creator.name` / `campaign.title`.
 * Neither the key nor the shape matched, so the list rendered empty whatever
 * the database held — and because Export is disabled on an empty list, that
 * button was permanently greyed out too. Creators could raise payout requests
 * from the portal that no one on the agency side could ever see.
 *
 * The route builds `creatorName`/`creatorHandle` from its own creator lookup
 * rather than a Prisma include, so flat is the deliberate shape; the client is
 * what was out of step.
 */
interface PayoutRequest {
  id: string;
  campaignId: string;
  campaignTitle: string | null;
  creatorId: string;
  creatorName: string | null;
  creatorHandle: string | null;
  requestedAmount: number;
  currency: string;
  status: string;
  rejectionReason?: string | null;
  processedAt?: string | null;
  createdAt: string;
}

const STATUS_TABS = [
  { key: "ALL", label: "All" },
  { key: "PENDING", label: "Pending" },
  { key: "APPROVED", label: "Approved" },
  { key: "REJECTED", label: "Rejected" },
];

export default function RequestsPage() {
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  /* A failed read is shown as a failure. It used to be swallowed, so the page
     said "No payout requests" for a list it had never received. */
  const [loadFailed, setLoadFailed] = useState(false);
  const [activeTab, setActiveTab] = useState("ALL");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // Over the creator and the campaign, which are the two things anyone knows a
  // request by.
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(REQUEST_PAGE_SIZE);

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/payout-requests");
      if (res.ok) {
        const data = await res.json();
        setRequests(data.payoutRequests ?? []);
        setLoadFailed(false);
      } else {
        setLoadFailed(true);
      }
    } catch {
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const handleAction = async (request: PayoutRequest, status: "APPROVED" | "REJECTED") => {
    const key = `${request.id}-${status}`;
    setActionLoading(key);
    try {
      const res = await fetch(`/api/campaigns/${request.campaignId}/payout-requests/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status,
          ...(status === "REJECTED" ? { rejectionReason: "Rejected by admin" } : {}),
        }),
      });
      if (res.ok) {
        await fetchRequests();
      } else {
        // Approve/Reject used to fail silently: the row stayed Pending and the
        // reviewer had no way to tell the click had been rejected.
        toast.error(`Couldn't ${status === "APPROVED" ? "approve" : "reject"} that request. It is unchanged.`);
      }
    } catch {
      toast.error("The request didn't go through. Nothing was changed.");
    } finally {
      setActionLoading(null);
    }
  };

  const byStatus = activeTab === "ALL" ? requests : requests.filter((r) => r.status === activeTab);
  const filtered = (() => {
    const q = query.trim().toLowerCase();
    if (!q) return byStatus;
    return byStatus.filter(
      (r) =>
        (r.creatorName ?? "").toLowerCase().includes(q) ||
        (r.creatorHandle ?? "").toLowerCase().includes(q) ||
        (r.campaignTitle ?? "").toLowerCase().includes(q),
    );
  })();
  const isFiltered = query.trim() !== "" || activeTab !== "ALL";
  const clearFilters = () => {
    setQuery("");
    setActiveTab("ALL");
    setPage(1);
  };

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const shown = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const totalRequests = requests.length;
  const pendingCount = requests.filter((r) => r.status === "PENDING").length;
  const approvedCount = requests.filter((r) => r.status === "APPROVED").length;
  /* Per currency, not one sum behind one symbol. A payout request carries its
     own currency -- the portal posts whatever the campaign is in -- so adding
     an INR request to a USD one and printing "$" produced a figure that is not
     true in either. Mixed currencies render as "₹40,000 · $500". */
  const approvedTotal = formatRowsByCurrency(
    requests
      .filter((r) => r.status === "APPROVED")
      .map((r) => ({ currency: r.currency, amount: r.requestedAmount }))
  );
  const rejectedCount = requests.filter((r) => r.status === "REJECTED").length;
  const tabCount: Record<string, number> = {
    ALL: totalRequests,
    PENDING: pendingCount,
    APPROVED: approvedCount,
    REJECTED: rejectedCount,
  };

  // Exports the rows on screen, so a status tab or a search narrows the file
  // the same way it narrows the list.
  const exportData = () => {
    downloadCsv(`payout-requests-${exportStamp()}`, [
      ["Requested", "Creator", "Handle", "Campaign", "Amount", "Currency", "Status"],
      ...filtered.map((r) => [
        formatDateAbs(r.createdAt),
        r.creatorName ?? "",
        r.creatorHandle ?? "",
        r.campaignTitle ?? "",
        r.requestedAmount,
        r.currency,
        r.status,
      ]),
    ]);
  };

  const columns: DataTableColumn<PayoutRequest>[] = [
    {
      key: "creator",
      header: "Creator",
      width: REQUEST_WIDTHS.creator,
      minWidth: 220,
      render: (r) => {
        const fallback = r.creatorName ?? r.creatorHandle ?? `Creator ${r.creatorId.slice(0, 6)}`;
        return (
          <div className="flex min-w-0 items-center gap-3">
            <CreatorAvatar id={r.creatorId} name={fallback} size="sm" />
            {r.creatorName || r.creatorHandle ? (
              <CreatorName name={r.creatorName} handle={r.creatorHandle} />
            ) : (
              <span className="cc-dt-truncate">{fallback}</span>
            )}
          </div>
        );
      },
    },
    {
      key: "campaign",
      header: "Campaign",
      width: REQUEST_WIDTHS.campaign,
      minWidth: 180,
      truncate: (r) => r.campaignTitle ?? undefined,
      render: (r) => r.campaignTitle ?? "Unknown campaign",
    },
    {
      key: "amount",
      header: "Amount",
      align: "right",
      width: REQUEST_WIDTHS.amount,
      render: (r) => formatMoney(r.requestedAmount, r.currency),
    },
    {
      key: "status",
      header: "Status",
      width: REQUEST_WIDTHS.status,
      render: (r) => <StatusBadge status={r.status} />,
    },
    {
      key: "requested",
      header: "Requested",
      width: REQUEST_WIDTHS.requested,
      render: (r) => formatDateAbs(r.createdAt),
    },
    {
      key: "actions",
      header: "Actions",
      hideHeader: true,
      align: "right",
      width: REQUEST_WIDTHS.actions,
      render: (r) =>
        r.status === "PENDING" ? (
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              loading={actionLoading === `${r.id}-APPROVED`}
              disabled={actionLoading !== null}
              onClick={() => handleAction(r, "APPROVED")}
            >
              Approve
            </Button>
            <Button
              variant="ghost"
              size="sm"
              loading={actionLoading === `${r.id}-REJECTED`}
              disabled={actionLoading !== null}
              onClick={() => handleAction(r, "REJECTED")}
            >
              Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Requests"
        subtitle="Payout requests from creators, to approve or reject"
        actions={
          <Button
            variant="secondary"
            iconLeft={<Download size={16} aria-hidden="true" />}
            disabled={filtered.length === 0}
            onClick={exportData}
            {...action("export-data")}
          >
            Export CSV
          </Button>
        }
        tabs={
          <StatusTabs
            ariaLabel="Filter by request status"
            tabs={STATUS_TABS.map((tab) => ({ ...tab, count: loading ? undefined : tabCount[tab.key] }))}
            active={activeTab}
            onChange={(key) => {
              setActiveTab(key);
              setPage(1);
            }}
          />
        }
      />

      {loading ? (
        <TileGridSkeleton count={4} style={{ marginBottom: 24 }} />
      ) : (
        <div className="cc-tiles-balanced mb-6">
          <MetricTile metric="requestsTotal" value={formatFull(totalRequests)} />
          <MetricTile metric="requestsPending" value={formatFull(pendingCount)} />
          <MetricTile metric="requestsApprovedAmount" value={approvedTotal} />
          <MetricTile metric="requestsRejected" value={formatFull(rejectedCount)} />
        </div>
      )}

      <ListToolbar
        search={{
          value: query,
          onChange: (v) => {
            setQuery(v);
            setPage(1);
          },
          placeholder: "Search requests",
          ariaLabel: "Search requests by creator or campaign",
        }}
      />

      {loadFailed ? (
        <LoadError
          title="We couldn't load payout requests"
          description="These requests were not read, which is not the same as there being none."
          onRetry={() => {
            setLoading(true);
            fetchRequests();
          }}
        />
      ) : (
        <DataTable
          caption="Payout requests"
          columns={columns}
          rows={shown}
          rowKey={(r) => r.id}
          loading={loading}
          skeletonRows={8}
          empty={
            isFiltered ? (
              <NoResults
                title="No requests match"
                description="Nothing matches this search and status."
                onClear={clearFilters}
              />
            ) : (
              <NoResults
                icon={<Inbox size={32} strokeWidth={1.75} />}
                title="No payout requests"
                description="Payout requests from creators will appear here."
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
              pageSizeOptions={REQUEST_PAGE_SIZES}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          }
        />
      )}
    </div>
  );
}
