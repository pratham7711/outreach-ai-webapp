"use client";
import { useState, useEffect, useCallback } from "react";
import { Button, Badge, Card, StatCard, Avatar, Skeleton, EmptyState } from "@pratham7711/ui";
import { Inbox } from "lucide-react";

interface PayoutRequest {
  id: string;
  campaignId: string;
  creatorId: string;
  requestedAmount: number;
  currency: string;
  status: string;
  createdAt: string;
  campaign?: { title: string };
  creator?: { name: string; handle: string };
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

  const fetchRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/payout-requests");
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests ?? []);
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
      }
    } catch {
      // silent
    } finally {
      setActionLoading(null);
    }
  };

  // Filtered list
  const filtered = activeTab === "ALL" ? requests : requests.filter((r) => r.status === activeTab);

  // Stats
  const totalRequests = requests.length;
  const pendingCount = requests.filter((r) => r.status === "PENDING").length;
  const approvedTotal = requests
    .filter((r) => r.status === "APPROVED")
    .reduce((sum, r) => sum + r.requestedAmount, 0);
  const rejectedCount = requests.filter((r) => r.status === "REJECTED").length;

  const formatCurrency = (amount: number, currency?: string) => {
    const sym = currency === "INR" ? "\u20B9" : "$";
    return `${sym}${amount.toLocaleString()}`;
  };

  return (
    <div className="cc-page-content">
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Requests</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>View and manage payout requests</p>
        </div>
      </div>

      {/* Stat Cards */}
      {loading ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
          {[1, 2, 3, 4].map((i) => (
            <div key={i} style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 20 }}>
              <Skeleton width={80} height={14} />
              <div style={{ marginTop: 8 }}><Skeleton width={48} height={28} /></div>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
          <StatCard value={String(totalRequests)} label="Total Requests" />
          <StatCard value={String(pendingCount)} label="Pending" />
          <StatCard value={formatCurrency(approvedTotal)} label="Approved Amount" />
          <StatCard value={String(rejectedCount)} label="Rejected" />
        </div>
      )}

      {/* Status Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              padding: "6px 14px",
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              border: "none",
              cursor: "pointer",
              background: activeTab === tab.key ? tab.bg : "transparent",
              color: activeTab === tab.key ? tab.color : "var(--cc-text-muted)",
              transition: "all 0.15s",
            }}
          >
            {tab.label}
            {tab.key !== "ALL" && (
              <span style={{ marginLeft: 6, fontSize: 11, opacity: 0.8 }}>
                {tab.key === "PENDING" ? pendingCount : tab.key === "APPROVED" ? requests.filter((r) => r.status === "APPROVED").length : rejectedCount}
              </span>
            )}
          </button>
        ))}
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
            const creatorName = r.creator?.name ?? r.creator?.handle ?? `Creator ${r.creatorId.slice(0, 6)}`;
            return (
              <div
                key={r.id}
                className="cc-table-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "14px 20px",
                  borderBottom: i < filtered.length - 1 ? "1px solid var(--cc-border)" : "none",
                }}
              >
                <Avatar name={creatorName} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, color: "var(--cc-text)" }}>{creatorName}</div>
                  <div style={{ fontSize: 12, color: "var(--cc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {r.campaign?.title ?? "Unknown campaign"}
                  </div>
                </div>
                <Badge variant={STATUS_BADGE[r.status] ?? "neutral"} size="sm">{r.status.toLowerCase()}</Badge>
                <div style={{ textAlign: "right", minWidth: 80 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>{formatCurrency(r.requestedAmount, r.currency)}</div>
                  <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{new Date(r.createdAt).toLocaleDateString()}</div>
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
