"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Button, Input, Modal, EmptyState, Skeleton } from "@pratham7711/ui";
import { StatusTabs } from "@/components/ds";
import { Banknote, Check, X } from "lucide-react";

type PayoutReq = {
  id: string;
  creatorId: string;
  requestedAmount: number;
  currency: string;
  status: string;
  rejectionReason: string | null;
  processedAt: string | null;
  createdAt: string;
};

type Creator = { id: string; name: string; handle: string };

const STATUS_TABS = [
  { key: "ALL", label: "All", bg: "#F3F4F6", color: "#374151" },
  { key: "PENDING", label: "Pending", bg: "#FEF3C7", color: "#D97706" },
  { key: "APPROVED", label: "Approved", bg: "#D1FAE5", color: "#059669" },
  { key: "REJECTED", label: "Rejected", bg: "#FEE2E2", color: "#DC2626" },
];

const STATUS_BADGE: Record<string, "warning" | "success" | "danger"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export default function PayoutRequestsSection({ campaignId }: { campaignId: string }) {
  const [requests, setRequests] = useState<PayoutReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [showReject, setShowReject] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [form, setForm] = useState({ creatorId: "", requestedAmount: "", currency: "USD" });
  const [rejectionReason, setRejectionReason] = useState("");

  const fetchRequests = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    const res = await fetch(`/api/campaigns/${campaignId}/payout-requests?${params}`);
    if (res.ok) {
      const data = await res.json();
      setRequests(Array.isArray(data.payoutRequests) ? data.payoutRequests : []);
    }
    setLoading(false);
  }, [campaignId, statusFilter]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const openCreate = async () => {
    setShowCreate(true);
    if (creators.length === 0) {
      const res = await fetch("/api/creators");
      if (res.ok) {
        const data = await res.json();
        setCreators((data.creators ?? data).map((c: any) => ({ id: c.id, name: c.name, handle: c.handle })));
      }
    }
  };

  const handleCreate = async () => {
    if (!form.creatorId || !form.requestedAmount) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/payout-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorId: form.creatorId,
          requestedAmount: Number(form.requestedAmount),
          currency: form.currency,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setForm({ creatorId: "", requestedAmount: "", currency: "USD" });
        fetchRequests();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (requestId: string) => {
    await fetch(`/api/campaigns/${campaignId}/payout-requests/${requestId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "APPROVED" }),
    });
    fetchRequests();
  };

  const handleReject = async () => {
    if (!showReject) return;
    await fetch(`/api/campaigns/${campaignId}/payout-requests/${showReject}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "REJECTED", rejectionReason: rejectionReason || null }),
    });
    setShowReject(null);
    setRejectionReason("");
    fetchRequests();
  };

  const selectStyle = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid var(--cc-border)",
    fontSize: 14,
    color: "var(--cc-text)",
    background: "white",
    outline: "none",
    boxSizing: "border-box" as const,
  };

  if (loading) return <Skeleton width="100%" height="100px" borderRadius="12px" />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "flex", alignItems: "center", gap: 8 }}>
          <Banknote size={16} /> Payout Requests
        </span>
        <Button variant="primary" onClick={openCreate}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Banknote size={14} /> Request Payout</span>
        </Button>
      </div>

      {/* Status filter tabs */}
      <StatusTabs
        variant="pill"
        ariaLabel="Filter payout requests by status"
        style={{ marginBottom: 16 }}
        tabs={STATUS_TABS}
        active={statusFilter}
        onChange={setStatusFilter}
      />

      {requests.length === 0 ? (
        <Card variant="outlined" style={{ padding: 24 }}>
          <EmptyState icon="💸" title="No payout requests" description="Payout requests from creators will appear here." />
        </Card>
      ) : (
        <Card variant="solid" noPadding>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 120px 100px 100px 120px 120px",
            gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
          }}>
            {["Creator", "Amount", "Currency", "Status", "Requested", "Actions"].map(h => (
              <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
            ))}
          </div>
          {requests.map((req, i) => (
            <div key={req.id} style={{
              display: "grid", gridTemplateColumns: "1fr 120px 100px 100px 120px 120px",
              gap: 12, padding: "14px 24px", alignItems: "center",
              borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
            }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{req.creatorId.slice(0, 8)}...</span>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--cc-text)" }}>{formatCurrency(req.requestedAmount, req.currency)}</span>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{req.currency}</span>
              <Badge variant={STATUS_BADGE[req.status] ?? "neutral"}>{req.status}</Badge>
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{new Date(req.createdAt).toLocaleDateString()}</span>
              <div style={{ display: "flex", gap: 4 }}>
                {req.status === "PENDING" && (
                  <>
                    <button onClick={() => handleApprove(req.id)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #059669", background: "#D1FAE5", color: "#059669", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 2 }}>
                      <Check size={12} /> Approve
                    </button>
                    <button onClick={() => setShowReject(req.id)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #DC2626", background: "#FEE2E2", color: "#DC2626", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 2 }}>
                      <X size={12} /> Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Create Request Modal */}
      {showCreate && (
        <Modal open={true} onClose={() => setShowCreate(false)} title="Request Payout" size="md" footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button variant="primary" loading={submitting} onClick={handleCreate} disabled={!form.creatorId || !form.requestedAmount}>Submit</Button>
          </div>
        }>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Creator</label>
              <select value={form.creatorId} onChange={(e) => setForm(f => ({ ...f, creatorId: e.target.value }))} style={selectStyle}>
                <option value="">Select creator...</option>
                {creators.map(c => <option key={c.id} value={c.id}>{c.name} (@{c.handle})</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <Input label="Amount" type="number" value={form.requestedAmount} onChange={(e) => setForm(f => ({ ...f, requestedAmount: e.target.value }))} placeholder="e.g. 500" required />
              </div>
              <div style={{ width: 110 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Currency</label>
                <select value={form.currency} onChange={(e) => setForm(f => ({ ...f, currency: e.target.value }))} style={selectStyle}>
                  <option>USD</option><option>EUR</option><option>GBP</option><option>INR</option>
                </select>
              </div>
            </div>
          </div>
        </Modal>
      )}

      {/* Reject Modal */}
      {showReject && (
        <Modal open={true} onClose={() => { setShowReject(null); setRejectionReason(""); }} title="Reject Payout Request" size="sm" footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => { setShowReject(null); setRejectionReason(""); }}>Cancel</Button>
            <Button variant="primary" onClick={handleReject} style={{ background: "#DC2626" }}>Reject</Button>
          </div>
        }>
          <div>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Reason (optional)</label>
            <textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} placeholder="Why is this request being rejected?" rows={3} style={{ ...selectStyle, resize: "vertical" as const }} />
          </div>
        </Modal>
      )}
    </div>
  );
}
