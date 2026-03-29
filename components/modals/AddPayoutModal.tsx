"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Button, Input } from "@pratham7711/ui";

type Creator = { id: string; name: string; handle: string };
type Campaign = { id: string; title: string };

export default function AddPayoutModal({
  creators,
  campaigns,
  onClose,
}: {
  creators: Creator[];
  campaigns: Campaign[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    creatorId: "",
    campaignId: "",
    amount: "",
    currency: "USD",
    status: "PENDING",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.creatorId || !form.amount) return;
    setLoading(true);
    try {
      const res = await fetch("/api/payouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorId: form.creatorId,
          campaignId: form.campaignId || undefined,
          amount: Number(form.amount),
          currency: form.currency,
        }),
      });
      if (res.ok) {
        router.refresh();
        onClose();
      }
    } finally {
      setLoading(false);
    }
  };

  const selectStyle = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid var(--cc-border)",
    fontSize: 14,
    color: "var(--cc-text)",
    outline: "none",
    background: "white",
    boxSizing: "border-box" as const,
  };

  const labelStyle = {
    display: "block" as const,
    fontSize: 13,
    fontWeight: 600 as const,
    color: "var(--cc-text)",
    marginBottom: 6,
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Process Payout"
      size="md"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            loading={loading}
            onClick={() => {
              document.getElementById("add-payout-form")?.dispatchEvent(
                new Event("submit", { cancelable: true, bubbles: true })
              );
            }}
          >
            Process Payout
          </Button>
        </div>
      }
    >
      <form id="add-payout-form" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div>
          <label style={labelStyle}>Creator *</label>
          <select
            required
            value={form.creatorId}
            onChange={(e) => setForm((f) => ({ ...f, creatorId: e.target.value }))}
            style={selectStyle}
          >
            <option value="">Select creator...</option>
            {creators.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.handle})</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Campaign (optional)</label>
          <select
            value={form.campaignId}
            onChange={(e) => setForm((f) => ({ ...f, campaignId: e.target.value }))}
            style={selectStyle}
          >
            <option value="">No campaign</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>{c.title}</option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Input
              label="Amount *"
              type="number"
              required
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              placeholder="e.g. 5000"
            />
          </div>
          <div style={{ width: 110 }}>
            <label style={labelStyle}>Currency</label>
            <select
              value={form.currency}
              onChange={(e) => setForm((f) => ({ ...f, currency: e.target.value }))}
              style={selectStyle}
            >
              <option>USD</option>
              <option>EUR</option>
              <option>GBP</option>
              <option>INR</option>
            </select>
          </div>
        </div>
      </form>
    </Modal>
  );
}
