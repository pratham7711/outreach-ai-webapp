"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Button, Input } from "@pratham7711/ui";

type Client = { id: string; name: string };

export default function NewCampaignModal({ clients, onClose }: { clients: Client[]; onClose: () => void }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    title: "",
    status: "DRAFT",
    budget: "",
    currency: "USD",
    clientId: "",
    campaignType: "BUDGET_BASED",
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          budget: form.budget ? Number(form.budget) : undefined,
          clientId: form.clientId || undefined,
          campaignType: form.campaignType,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/campaigns/${data.id}`);
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
    background: "var(--cc-card)",
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
      title="New Campaign"
      size="md"
      footer={
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" loading={loading} onClick={() => { document.getElementById("new-campaign-form")?.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true })); }}>
            Create Campaign
          </Button>
        </div>
      }
    >
      <form id="new-campaign-form" onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Input
          label="Campaign Name"
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          placeholder="e.g. Summer Drop 2026"
          required
        />
        <div>
          <label htmlFor="campaign-client" style={labelStyle}>Client</label>
          <select
            id="campaign-client"
            value={form.clientId}
            onChange={(e) => setForm((f) => ({ ...f, clientId: e.target.value }))}
            style={selectStyle}
          >
            <option value="">No client</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="campaign-status" style={labelStyle}>Status</label>
          <select
            id="campaign-status"
            value={form.status}
            onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
            style={selectStyle}
          >
            <option value="DRAFT">Draft</option>
            <option value="PENDING">Pending</option>
            <option value="IN_PROGRESS">In Progress</option>
            <option value="COMPLETE">Complete</option>
          </select>
        </div>
        <div>
          <label htmlFor="campaign-type" style={labelStyle}>Campaign Type</label>
          <select
            id="campaign-type"
            value={form.campaignType}
            onChange={(e) => setForm((f) => ({ ...f, campaignType: e.target.value }))}
            style={selectStyle}
          >
            <option value="BUDGET_BASED">Budget Based</option>
            <option value="VIEW_BASED">View Based</option>
            <option value="OPEN_COMMUNITY">Open Community</option>
            <option value="PRIVATE_INVITE">Private Invite</option>
          </select>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1 }}>
            <Input
              label="Budget"
              type="number"
              value={form.budget}
              onChange={(e) => setForm((f) => ({ ...f, budget: e.target.value }))}
              placeholder="e.g. 10000"
            />
          </div>
          <div style={{ width: 110 }}>
            <label htmlFor="campaign-currency" style={labelStyle}>Currency</label>
            <select
              id="campaign-currency"
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
