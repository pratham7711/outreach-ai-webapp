"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Button, Input } from "@pratham7711/ui";
import { Dropdown } from "@/components/ds";

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
          <Dropdown
            ariaLabel="Creator"
            align="left"
            fullWidth
            value={form.creatorId}
            onChange={(v) => setForm((f) => ({ ...f, creatorId: v }))}
            options={[
              { value: "", label: "Select creator..." },
              ...creators.map((c) => ({ value: c.id, label: `${c.name} (${c.handle})` })),
            ]}
          />
        </div>
        <div>
          <label style={labelStyle}>Campaign (optional)</label>
          <Dropdown
            ariaLabel="Campaign"
            align="left"
            fullWidth
            value={form.campaignId}
            onChange={(v) => setForm((f) => ({ ...f, campaignId: v }))}
            options={[
              { value: "", label: "No campaign" },
              ...campaigns.map((c) => ({ value: c.id, label: c.title })),
            ]}
          />
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
            <Dropdown
              ariaLabel="Currency"
              align="left"
              fullWidth
              value={form.currency}
              onChange={(v) => setForm((f) => ({ ...f, currency: v }))}
              options={["USD", "EUR", "GBP", "INR"].map((c) => ({ value: c, label: c }))}
            />
          </div>
        </div>
      </form>
    </Modal>
  );
}
