"use client";
import { useState, useEffect, useCallback } from "react";
import { Badge, Card, Avatar, Skeleton, EmptyState, Input } from "@pratham7711/ui";
import { PageHeader, MetricTile, Button } from "@/components/ds";
import { StatusTabs } from "@/components/ds";
import { formatDateAbs } from "@/lib/format";
import { Inbox, Search, Download } from "lucide-react";
import { downloadCsv, exportStamp } from "@/lib/csv";
import { toast } from "sonner";

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
  { key: "ALL", label: "All", bg: "#F3F4F6", color: "#374151" },
  { key: "PENDING", label: "Pending", bg: "#FEF3C7", color: "#D97706" },
  { key: "APPROVED", label: "Approved", bg: "#D1FAE5", color: "#059669" },
  { key: "REJECTED", label: "Rejected", bg: "#FEE2E2", color: "#DC2626" },
];

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

export default function RequestsPage() {
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("ALL");
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // The reference lets this list be searched. Over the creator and the campaign,
  // which are the two things anyone knows a request by.
  const [query, setQuery] = useState("");

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/payout-requests");
      if (res.ok) {
        const data = await res.json();
        setRequests(data.payoutRequests ?? []);
      }
    } catch {
      // silent
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

  // Filtered list
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

  // Stats
  const totalRequests = requests.length;
  const pendingCount = requests.filter((r) => r.status === "PENDING").length;
  const approvedTotal = requests
    .filter((r) => r.status === "APPROVED")
    .reduce((sum, r) => sum + r.requestedAmount, 0);
  const rejectedCount = requests.filter((r) => r.status === "REJECTED").length;

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

  const formatCurrency = (amount: number, currency?: string) => {
    const sym = currency === "INR" ? "\u20B9" : "$";
    return `${sym}${amount.toLocaleString()}`;
  };

  return (
    <div className="rsp-page">
      <PageHeader
        title="Requests"
        subtitle="View and manage payout requests"
        actions={
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<Download size={15} />}
            disabled={filtered.length === 0}
            onClick={exportData}
          >
            Export Data
          </Button>
        }
      />

      {/* Stat Cards */}
      {loading ? (
        <div className="rsp-grid-tiles" style={{ marginBottom: 32 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 20 }}>
              <Skeleton width={80} height={14} />
              <div style={{ marginTop: 8 }}><Skeleton width={48} height={28} /></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rsp-grid-tiles" style={{ marginBottom: 32 }}>
          <MetricTile metric="requestsTotal" value={String(totalRequests)} />
          <MetricTile metric="requestsPending" value={String(pendingCount)} />
          <MetricTile metric="requestsApprovedAmount" value={formatCurrency(approvedTotal)} />
          <MetricTile metric="requestsRejected" value={String(rejectedCount)} />
        </div>
      )}

      {/* Status Tabs */}
      <StatusTabs
        variant="pill"
        ariaLabel="Filter by request status"
        style={{ marginBottom: 24 }}
        tabs={STATUS_TABS.map((tab) => ({
          ...tab,
          count:
            tab.key === "PENDING"
              ? pendingCount
              : tab.key === "APPROVED"
                ? requests.filter((r) => r.status === "APPROVED").length
                : tab.key === "REJECTED"
                  ? rejectedCount
                  : undefined,
        }))}
        active={activeTab}
        onChange={setActiveTab}
      />

      <div style={{ maxWidth: 340, marginBottom: 16 }}>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Requests"
          aria-label="Search Requests"
          iconLeft={<Search size={16} />}
        />
      </div>

      {/* Request List */}
      {loading ? (
        <Card variant="outlined" noPadding>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
            <Skeleton width={140} height={16} />
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 16, padding: "14px 20px", borderBottom: i < 3 ? "1px solid var(--cc-border)" : "none" }}>
              <Skeleton width={36} height={36} borderRadius="50%" />
              <div style={{ flex: 1 }}>
                <Skeleton width={180} height={14} />
                <div style={{ marginTop: 4 }}><Skeleton width={120} height={12} /></div>
              </div>
              <Skeleton width={60} height={24} borderRadius="6px" />
              <Skeleton width={60} height={14} />
            </div>
          ))}
        </Card>
      ) : filtered.length === 0 && query.trim() ? (
        <EmptyState
          icon={<Search size={32} color="var(--cc-text-subtle)" />}
          title="No requests match that search"
          description={`No requests match "${query}".`}
          action={<Button variant="secondary" onClick={() => setQuery("")}>Clear search</Button>}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<Inbox size={40} />}
          title={activeTab === "ALL" ? "No payout requests" : `No ${activeTab.toLowerCase()} requests`}
          description={activeTab === "ALL" ? "Payout requests from creators will appear here." : `There are no requests with status "${activeTab.toLowerCase()}".`}
        />
      ) : (
        <Card variant="outlined" noPadding>
          <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--cc-border)" }}>
            <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>
              {activeTab === "ALL" ? "All Requests" : `${STATUS_TABS.find((t) => t.key === activeTab)?.label} Requests`}
            </span>
            <span style={{ fontSize: 13, color: "var(--cc-text-muted)", marginLeft: 8 }}>({filtered.length})</span>
          </div>
          {filtered.map((r, i) => {
            const creatorName = r.creatorName ?? r.creatorHandle ?? `Creator ${r.creatorId.slice(0, 6)}`;
            return (
              <div
                key={r.id}
                className="cc-table-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "14px 20px",
                  flexWrap: "wrap",
                  borderBottom: i < filtered.length - 1 ? "1px solid var(--cc-border)" : "none",
                }}
              >
                <Avatar name={creatorName} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--cc-text)" }}>{creatorName}</div>
                  <div title={r.campaignTitle ?? undefined} style={{ fontSize: 12, color: "var(--cc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.campaignTitle ?? "Unknown campaign"}
                  </div>
                </div>
                <Badge variant={STATUS_BADGE[r.status] ?? "neutral"} size="sm">{r.status.toLowerCase()}</Badge>
                <div style={{ textAlign: "right", minWidth: 80 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>{formatCurrency(r.requestedAmount, r.currency)}</div>
                  <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{formatDateAbs(r.createdAt)}</div>
                </div>
                {r.status === "PENDING" && (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleAction(r, "APPROVED")}
                      disabled={actionLoading === `${r.id}-APPROVED`}
                    >
                      {actionLoading === `${r.id}-APPROVED` ? "..." : "Approve"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleAction(r, "REJECTED")}
                      disabled={actionLoading === `${r.id}-REJECTED`}
                    >
                      {actionLoading === `${r.id}-REJECTED` ? "..." : "Reject"}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </div>
  );
}
