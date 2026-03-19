"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { useRouter } from "next/navigation";

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

  const inputStyle = { width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)", fontSize: 14, color: "var(--cc-text)", outline: "none", background: "white", boxSizing: "border-box" as const };
  const labelStyle = { fontSize: 12, fontWeight: 600 as const, color: "var(--cc-text)", display: "block" as const, marginBottom: 6 };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "white", borderRadius: 16, padding: 32, width: "100%", maxWidth: 480, boxShadow: "0 20px 60px rgba(0,0,0,0.15)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}>Process Payout</h2>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)" }}><X size={20} /></button>
        </div>
        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={labelStyle}>Creator *</label>
            <select required value={form.creatorId} onChange={e => setForm(f => ({ ...f, creatorId: e.target.value }))}
              style={inputStyle}>
              <option value="">Select creator...</option>
              {creators.map(c => (
                <option key={c.id} value={c.id}>{c.name} ({c.handle})</option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Campaign (optional)</label>
            <select value={form.campaignId} onChange={e => setForm(f => ({ ...f, campaignId: e.target.value }))}
              style={inputStyle}>
              <option value="">No campaign</option>
              {campaigns.map(c => (
                <option key={c.id} value={c.id}>{c.title}</option>
              ))}
            </select>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={labelStyle}>Amount *</label>
              <input required type="number" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                placeholder="e.g. 5000" style={inputStyle} />
            </div>
            <div style={{ width: 100 }}>
              <label style={labelStyle}>Currency</label>
              <select value={form.currency} onChange={e => setForm(f => ({ ...f, currency: e.target.value }))}
                style={inputStyle}>
                <option>USD</option><option>EUR</option><option>GBP</option><option>INR</option>
              </select>
            </div>
          </div>
          <button type="submit" disabled={loading}
            style={{ padding: "12px", borderRadius: 10, background: "var(--cc-primary)", color: "white", fontSize: 14, fontWeight: 600, border: "none", cursor: loading ? "not-allowed" : "pointer", opacity: loading ? 0.7 : 1, marginTop: 8 }}>
            {loading ? "Processing..." : "Process Payout"}
          </button>
        </form>
      </div>
    </div>
  );
}
