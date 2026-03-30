"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Button, Input, Modal, EmptyState, Skeleton } from "@pratham7711/ui";
import { DollarSign, CreditCard } from "lucide-react";

type Deposit = {
  id: string;
  amountRequested: number;
  amountUsd: number;
  currency: string;
  gateway: string;
  method: string | null;
  gatewayOrderId: string | null;
  status: string;
  releasedAmount: number;
  createdAt: string;
};

const STATUS_BADGE: Record<string, "warning" | "success" | "accent" | "neutral" | "danger"> = {
  PENDING: "warning",
  HELD: "accent",
  PARTIALLY_RELEASED: "accent",
  FULLY_RELEASED: "success",
  REFUNDED: "danger",
};

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export default function DepositsSection({ campaignId }: { campaignId: string }) {
  const [deposit, setDeposit] = useState<Deposit | null>(null);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showRelease, setShowRelease] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [createForm, setCreateForm] = useState({ amountRequested: "", currency: "USD", gateway: "STRIPE", method: "" });
  const [releaseAmount, setReleaseAmount] = useState("");

  const fetchDeposit = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/deposits`);
    if (res.ok) {
      const data = await res.json();
      setDeposit(data.deposit);
    }
    setLoading(false);
  }, [campaignId]);

  useEffect(() => { fetchDeposit(); }, [fetchDeposit]);

  const handleCreate = async () => {
    if (!createForm.amountRequested) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/deposits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountRequested: Number(createForm.amountRequested),
          currency: createForm.currency,
          gateway: createForm.gateway,
          method: createForm.method || null,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setCreateForm({ amountRequested: "", currency: "USD", gateway: "STRIPE", method: "" });
        fetchDeposit();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleRelease = async () => {
    if (!releaseAmount) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/deposits/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(releaseAmount) }),
      });
      if (res.ok) {
        setShowRelease(false);
        setReleaseAmount("");
        fetchDeposit();
      }
    } finally {
      setSubmitting(false);
    }
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

  if (loading) return <Skeleton width="100%" height="120px" borderRadius="12px" />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "flex", alignItems: "center", gap: 8 }}>
          <CreditCard size={16} /> Campaign Deposit
        </span>
        {!deposit && (
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}><DollarSign size={14} /> Create Deposit</span>
          </Button>
        )}
      </div>

      {!deposit ? (
        <Card variant="outlined" style={{ padding: 24 }}>
          <EmptyState icon="💳" title="No deposit" description="Create a deposit to hold funds for this campaign." />
        </Card>
      ) : (
        <Card variant="outlined" style={{ padding: 24 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)" }}>{formatCurrency(deposit.amountUsd, deposit.currency)}</span>
                <Badge variant={STATUS_BADGE[deposit.status] ?? "neutral"}>{deposit.status.replace(/_/g, " ")}</Badge>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--cc-text-muted)" }}>
                <span>Gateway: <strong>{deposit.gateway}</strong></span>
                {deposit.method && <span>Method: <strong>{deposit.method}</strong></span>}
                <span>Created: {new Date(deposit.createdAt).toLocaleDateString()}</span>
              </div>
            </div>
            {deposit.status !== "FULLY_RELEASED" && deposit.status !== "REFUNDED" && (
              <Button variant="secondary" onClick={() => setShowRelease(true)}>Release Funds</Button>
            )}
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 4 }}>
              <span>Released: {formatCurrency(deposit.releasedAmount, deposit.currency)}</span>
              <span>Remaining: {formatCurrency(deposit.amountUsd - deposit.releasedAmount, deposit.currency)}</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: "var(--cc-bg)" }}>
              <div style={{
                height: "100%",
                borderRadius: 4,
                width: `${deposit.amountUsd > 0 ? Math.min(100, (deposit.releasedAmount / deposit.amountUsd) * 100) : 0}%`,
                background: "linear-gradient(90deg, var(--cc-primary), #7C3AED)",
                transition: "width 0.4s",
              }} />
            </div>
          </div>
        </Card>
      )}

      {/* Create Deposit Modal */}
      {showCreate && (
        <Modal open={true} onClose={() => setShowCreate(false)} title="Create Deposit" size="md" footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button variant="primary" loading={submitting} onClick={handleCreate} disabled={!createForm.amountRequested}>Create</Button>
          </div>
        }>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <Input label="Amount" type="number" value={createForm.amountRequested} onChange={(e) => setCreateForm(f => ({ ...f, amountRequested: e.target.value }))} placeholder="e.g. 5000" required />
              </div>
              <div style={{ width: 110 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Currency</label>
                <select value={createForm.currency} onChange={(e) => setCreateForm(f => ({ ...f, currency: e.target.value }))} style={selectStyle}>
                  <option>USD</option><option>EUR</option><option>GBP</option><option>INR</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Payment Gateway</label>
              <select value={createForm.gateway} onChange={(e) => setCreateForm(f => ({ ...f, gateway: e.target.value }))} style={selectStyle}>
                <option value="STRIPE">Stripe</option>
                <option value="RAZORPAY">Razorpay</option>
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Payment Method</label>
              <select value={createForm.method} onChange={(e) => setCreateForm(f => ({ ...f, method: e.target.value }))} style={selectStyle}>
                <option value="">Select...</option>
                <option value="CARD">Card</option><option value="UPI">UPI</option><option value="NEFT">NEFT</option>
                <option value="IMPS">IMPS</option><option value="RTGS">RTGS</option><option value="ENACH">eNACH</option>
                <option value="WIRE">Wire Transfer</option>
              </select>
            </div>
          </div>
        </Modal>
      )}

      {/* Release Funds Modal */}
      {showRelease && deposit && (
        <Modal open={true} onClose={() => setShowRelease(false)} title="Release Funds" size="sm" footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setShowRelease(false)}>Cancel</Button>
            <Button variant="primary" loading={submitting} onClick={handleRelease} disabled={!releaseAmount}>Release</Button>
          </div>
        }>
          <div>
            <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 12 }}>
              Available: {formatCurrency(deposit.amountUsd - deposit.releasedAmount, deposit.currency)}
            </p>
            <Input label="Amount to Release" type="number" value={releaseAmount} onChange={(e) => setReleaseAmount(e.target.value)} placeholder="e.g. 1000" required />
          </div>
        </Modal>
      )}
    </div>
  );
}
