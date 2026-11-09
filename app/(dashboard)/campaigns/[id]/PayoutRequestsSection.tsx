"use client";

import { useState, useEffect, useCallback, useId } from "react";
import { Card, Badge, Input, EmptyState, Textarea } from "@pratham7711/ui";
import { Modal, ModalSection } from "@/components/ds/Modal";
import { Dropdown, StatusTabs, Button, Skeleton } from "@/components/ds";
import { Banknote, Check, X, XCircle } from "lucide-react";
import { CreatorSelect } from "@/components/CreatorSelect";
import { formatDateAbs, stripAt } from "@/lib/format";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import { creatorNameText } from "@/lib/creators/creatorName";

type PayoutReq = {
  id: string;
  creatorId: string;
  /** Resolved by the route; null once the creator has been deleted. */
  creator: { id: string; name: string; handle: string } | null;
  requestedAmount: number;
  currency: string;
  status: string;
  rejectionReason: string | null;
  processedAt: string | null;
  createdAt: string;
};

/* Nobody can approve a payout to "cmt1m1wq...". The route resolves the name
   now; this only formats it. */
function creatorName(creator: { name: string; handle: string } | null): string {
  return creator ? creatorNameText(creator.name, creator.handle) : "Deleted creator";
}

const STATUS_TABS = [
  { key: "ALL", label: "All", bg: "var(--cc-neutral-bg)", color: "var(--cc-status-neutral-ink)" },
  { key: "PENDING", label: "Pending", bg: "var(--cc-warning-bg)", color: "var(--cc-warning-ink)" },
  { key: "APPROVED", label: "Approved", bg: "var(--cc-success-bg)", color: "var(--cc-success)" },
  { key: "REJECTED", label: "Rejected", bg: "var(--cc-danger-bg)", color: "var(--cc-danger)" },
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
  const [form, setForm] = useState({ creatorId: "", requestedAmount: "", currency: "USD" });
  const [rejectionReason, setRejectionReason] = useState("");
  const currencyId = useId();

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

  const openCreate = () => {
    setShowCreate(true);
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

  if (loading) return <Skeleton width="100%" height="100px" borderRadius="12px" />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span className="cc-panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
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
        <Card variant="outlined">
          <EmptyState icon={<Banknote size={32} color="var(--cc-text-subtle)" />} title="No payout requests" description="Payout requests from creators will appear here." />
        </Card>
      ) : (
        <Card variant="solid" noPadding>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 120px 100px 100px 120px 120px",
            gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
          }}>
            {["Creator", "Amount", "Currency", "Status", "Requested", "Actions"].map(h => (
              <span key={h} className="cc-microlabel">{h}</span>
            ))}
          </div>
          {requests.map((req, i) => (
            <div key={req.id} style={{
              display: "grid", gridTemplateColumns: "1fr 120px 100px 100px 120px 120px",
              gap: 12, padding: "14px 24px", alignItems: "center",
              borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>
                <CreatorAvatar id={req.creator?.id ?? req.creatorId} name={req.creator?.name ?? "Deleted creator"} size="sm" />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{creatorName(req.creator)}</span>
              </span>
              <span style={{ fontSize: "var(--cc-t-14)", fontWeight: 700, color: "var(--cc-text)" }}>{formatCurrency(req.requestedAmount, req.currency)}</span>
              <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>{req.currency}</span>
              <Badge variant={STATUS_BADGE[req.status] ?? "neutral"}>{req.status}</Badge>
              <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>{formatDateAbs(req.createdAt)}</span>
              <div style={{ display: "flex", gap: 4 }}>
                {req.status === "PENDING" && (
                  <>
                    <button onClick={() => handleApprove(req.id)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--cc-success)", background: "color-mix(in srgb, var(--cc-success) 14%, transparent)", color: "var(--cc-success)", cursor: "pointer", fontSize: "var(--cc-t-11)", display: "flex", alignItems: "center", gap: 2 }}>
                      <Check size={12} /> Approve
                    </button>
                    <button onClick={() => setShowReject(req.id)} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--cc-danger)", background: "color-mix(in srgb, var(--cc-danger) 14%, transparent)", color: "var(--cc-danger-ink)", cursor: "pointer", fontSize: "var(--cc-t-11)", display: "flex", alignItems: "center", gap: 2 }}>
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
        <Modal
          open={true}
          onClose={() => setShowCreate(false)}
          icon={Banknote}
          tone="brand"
          title="Request Payout"
          description="Create a payout request for one creator on this campaign."
          size="md"
          dismissible={false}
          footer={
            <div className="cc-modal-footer">
              <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={submitting} onClick={handleCreate} disabled={!form.creatorId || !form.requestedAmount}>Submit</Button>
            </div>
          }
        >
          <ModalSection title="Creator">
            <CreatorSelect
              value={form.creatorId}
              onChange={(id) => setForm(f => ({ ...f, creatorId: id }))}
            />
          </ModalSection>
          <ModalSection>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Input label="Amount" type="number" value={form.requestedAmount} onChange={(e) => setForm(f => ({ ...f, requestedAmount: e.target.value }))} placeholder="e.g. 500" required />
              </div>
              <div className="ui-input-root" style={{ width: 120 }}>
                <label htmlFor={currencyId} className="ui-input-label">Currency</label>
                <Dropdown
                  id={currencyId}
                  align="left"
                  fullWidth
                  value={form.currency}
                  onChange={(v) => setForm(f => ({ ...f, currency: v }))}
                  options={["USD", "EUR", "GBP", "INR"].map((c) => ({ value: c, label: c }))}
                />
              </div>
            </div>
          </ModalSection>
        </Modal>
      )}

      {/* Reject Modal */}
      {showReject && (
        <Modal
          open={true}
          onClose={() => { setShowReject(null); setRejectionReason(""); }}
          icon={XCircle}
          tone="danger"
          title="Reject Payout Request"
          description="The request is marked Rejected, with your reason stored on it."
          size="sm"
          footer={
            <div className="cc-modal-footer">
              <Button variant="secondary" size="sm" onClick={() => { setShowReject(null); setRejectionReason(""); }}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleReject}>Reject</Button>
            </div>
          }
        >
          <Textarea
            label="Reason"
            value={rejectionReason}
            onChange={(e) => setRejectionReason(e.target.value)}
            placeholder="Why is this request being rejected?"
            rows={3}
          />
        </Modal>
      )}
    </div>
  );
}
