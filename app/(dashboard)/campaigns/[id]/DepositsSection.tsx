"use client";

import { useState, useEffect, useCallback, useId } from "react";
import { Card, Badge, Input, EmptyState } from "@pratham7711/ui";
import { Modal, ModalOption, ModalOptionList } from "@/components/ds/Modal";
import { DollarSign, CreditCard, HandCoins, Wallet } from "lucide-react";
import { formatDateAbs } from "@/lib/format";
import { enumLabel } from "@/lib/ui/enumLabel";
import { Dropdown, Button, Field, Skeleton } from "@/components/ds";

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
  const currencyId = useId();

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

  if (loading) return <Skeleton width="100%" height="120px" borderRadius="12px" />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span className="cc-panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <CreditCard size={16} /> Campaign Deposit
        </span>
        {!deposit && (
          <Button variant="primary" onClick={() => setShowCreate(true)}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}><DollarSign size={14} /> Create Deposit</span>
          </Button>
        )}
      </div>

      {!deposit ? (
        <Card variant="outlined">
          <EmptyState icon={<CreditCard size={32} color="var(--cc-text-subtle)" />} title="No deposit" description="Create a deposit to hold funds for this campaign." />
        </Card>
      ) : (
        <Card variant="outlined">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", marginBottom: 16 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: "var(--cc-t-24)", fontWeight: 700, color: "var(--cc-text)" }}>{formatCurrency(deposit.amountUsd, deposit.currency)}</span>
                <Badge variant={STATUS_BADGE[deposit.status] ?? "neutral"}>{enumLabel(deposit.status)}</Badge>
              </div>
              <div style={{ display: "flex", gap: 16, fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
                <span>Gateway: <strong>{deposit.gateway}</strong></span>
                {deposit.method && <span>Method: <strong>{deposit.method}</strong></span>}
                <span>Created: {formatDateAbs(deposit.createdAt)}</span>
              </div>
            </div>
            {deposit.status !== "FULLY_RELEASED" && deposit.status !== "REFUNDED" && (
              <Button variant="secondary" onClick={() => setShowRelease(true)}>Release Funds</Button>
            )}
          </div>

          {/* Progress bar */}
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", marginBottom: 4 }}>
              <span>Released: {formatCurrency(deposit.releasedAmount, deposit.currency)}</span>
              <span>Remaining: {formatCurrency(deposit.amountUsd - deposit.releasedAmount, deposit.currency)}</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: "var(--cc-bg)" }}>
              <div style={{
                height: "100%",
                borderRadius: 4,
                width: `${deposit.amountUsd > 0 ? Math.min(100, (deposit.releasedAmount / deposit.amountUsd) * 100) : 0}%`,
                background: "var(--cc-primary)",
                transition: "width 0.4s",
              }} />
            </div>
          </div>
        </Card>
      )}

      {/* Create Deposit Modal */}
      {showCreate && (
        <Modal
          open={true}
          onClose={() => setShowCreate(false)}
          icon={Wallet}
          tone="brand"
          title="Create Deposit"
          description="Set the deposit amount, currency and payment gateway for this campaign."
          size="md"
          dismissible={false}
          footer={
            <div className="cc-modal-footer">
              <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={submitting} onClick={handleCreate} disabled={!createForm.amountRequested}>Create</Button>
            </div>
          }
        >
          <div className="cc-dialog-stack">
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Input label="Amount" type="number" value={createForm.amountRequested} onChange={(e) => setCreateForm(f => ({ ...f, amountRequested: e.target.value }))} placeholder="e.g. 5000" required />
              </div>
              <div className="ui-input-root" style={{ width: 120 }}>
                <label htmlFor={currencyId} className="ui-input-label">Currency</label>
                <Dropdown
                  id={currencyId}
                  align="left"
                  fullWidth
                  value={createForm.currency}
                  onChange={(v) => setCreateForm(f => ({ ...f, currency: v }))}
                  options={["USD", "EUR", "GBP", "INR"].map((c) => ({ value: c, label: c }))}
                />
              </div>
            </div>
            <Field label="Payment gateway">
              <Dropdown
                align="left"
                fullWidth
                value={createForm.gateway}
                onChange={(v) => setCreateForm(f => ({ ...f, gateway: v }))}
                options={[
                  { value: "STRIPE", label: "Stripe" },
                  { value: "RAZORPAY", label: "Razorpay" },
                ]}
              />
            </Field>
            <Field label="Payment method">
              <Dropdown
                align="left"
                fullWidth
                value={createForm.method}
                onChange={(v) => setCreateForm(f => ({ ...f, method: v }))}
                options={[
                  { value: "", label: "Select..." },
                  { value: "CARD", label: "Card" },
                  { value: "UPI", label: "UPI" },
                  { value: "NEFT", label: "NEFT" },
                  { value: "IMPS", label: "IMPS" },
                  { value: "RTGS", label: "RTGS" },
                  { value: "ENACH", label: "eNACH" },
                  { value: "WIRE", label: "Wire transfer" },
                ]}
              />
            </Field>
          </div>
        </Modal>
      )}

      {/* Release Funds Modal */}
      {showRelease && deposit && (
        <Modal
          open={true}
          onClose={() => setShowRelease(false)}
          icon={HandCoins}
          tone="brand"
          title="Release Funds"
          description="Release funds from this campaign's deposit."
          size="sm"
          dismissible={false}
          footer={
            <div className="cc-modal-footer">
              <Button variant="secondary" size="sm" onClick={() => setShowRelease(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={submitting} onClick={handleRelease} disabled={!releaseAmount}>Release</Button>
            </div>
          }
        >
          <div className="cc-dialog-stack">
            <ModalOptionList>
              <ModalOption
                as="div"
                icon={Wallet}
                title={formatCurrency(deposit.amountUsd - deposit.releasedAmount, deposit.currency)}
                description="Available"
              />
            </ModalOptionList>
            <Input label="Amount to Release" type="number" value={releaseAmount} onChange={(e) => setReleaseAmount(e.target.value)} placeholder="e.g. 1000" required />
          </div>
        </Modal>
      )}
    </div>
  );
}
