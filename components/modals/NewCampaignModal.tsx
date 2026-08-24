"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Input } from "@pratham7711/ui";
import { Dropdown, Button } from "@/components/ds";

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
          <Dropdown
            ariaLabel="Client"
            align="left"
            fullWidth
            value={form.clientId}
            onChange={(v) => setForm((f) => ({ ...f, clientId: v }))}
            options={[
              { value: "", label: "No client" },
              ...clients.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />
        </div>
        <div>
          <label htmlFor="campaign-status" style={labelStyle}>Status</label>
          <Dropdown
            ariaLabel="Status"
            align="left"
            fullWidth
            value={form.status}
            onChange={(v) => setForm((f) => ({ ...f, status: v }))}
            options={[
              { value: "DRAFT", label: "Draft" },
              { value: "PENDING", label: "Pending" },
              { value: "IN_PROGRESS", label: "In Progress" },
              { value: "COMPLETE", label: "Complete" },
            ]}
          />
        </div>
        <div>
          <label htmlFor="campaign-type" style={labelStyle}>Campaign Type</label>
          <Dropdown
            ariaLabel="Campaign Type"
            align="left"
            fullWidth
            value={form.campaignType}
            onChange={(v) => setForm((f) => ({ ...f, campaignType: v }))}
            options={[
              { value: "BUDGET_BASED", label: "Budget Based" },
              { value: "VIEW_BASED", label: "View Based" },
              { value: "OPEN_COMMUNITY", label: "Open Community" },
              { value: "PRIVATE_INVITE", label: "Private Invite" },
            ]}
          />
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
