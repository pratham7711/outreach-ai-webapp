"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";

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
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, budget: form.budget ? Number(form.budget) : undefined, clientId: form.clientId || undefined }),
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

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "white", borderRadius: 16, padding: 32, width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}>New Campaign</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)" }}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text)", display: "block", marginBottom: 6 }}>Campaign Name *</label>
            <input required value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Summer Drop 2026"
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", outline: "none", boxSizing: "border-box" }} />
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text)", display: "block", marginBottom: 6 }}>Client</label>
            <select value={form.clientId} onChange={e => setForm(f => ({ ...f, clientId: e.target.value }))}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", outline: "none", background: "white" }}>
              <option value="">No client</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text)", display: "block", marginBottom: 6 }}>Status</label>
            <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
              style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", outline: "none", background: "white" }}>
              <option value="DRAFT">Draft</option>
              <option value="PENDING">Pending</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETE">Complete</option>
            </select>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text)", display: "block", marginBottom: 6 }}>Budget</label>
              <input type="number" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))}
                placeholder="e.g. 10000"
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", outline: "none", boxSizing: "border-box" }} />
            </div>
            <div style={{ width: 100 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: "var(--cc-text)", display: "block", marginBottom: 6 }}>Currency</label>
              <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", outline: "none", background: "white" }}>
                <option>USD</option><option>EUR</option><option>GBP</option><option>INR</option>
              </select>
            </div>
          </div>
          <button type="submit" disabled={loading}
            style={{ padding: "12px", borderRadius: 10, background: "var(--cc-primary)", color: "white", fontSize: 14, fontWeight: 600, border: "none", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, marginTop: 8 }}>
            {loading ? "Creating..." : "Create Campaign"}
          </button>
        </form>
      </div>
    </div>
  );
}
