"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Button, Input, Modal, EmptyState, Skeleton } from "@pratham7711/ui";
import { Handshake, Check, X, ArrowRightLeft } from "lucide-react";

type Offer = {
  id: string;
  creatorId: string;
  offeredRate: number;
  counterRate: number | null;
  currency: string;
  status: string;
  notes: string | null;
  createdAt: string;
};

type Creator = { id: string; name: string; handle: string };

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "accent"> = {
  PENDING: "warning",
  ACCEPTED: "success",
  REJECTED: "danger",
  COUNTERED: "accent",
};

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export default function NegotiationsSection({ campaignId }: { campaignId: string }) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showCounter, setShowCounter] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [form, setForm] = useState({ creatorId: "", offeredRate: "", currency: "USD", notes: "" });
  const [counterRate, setCounterRate] = useState("");

  const fetchOffers = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/negotiations`);
    if (res.ok) {
      const data = await res.json();
      setOffers(Array.isArray(data.negotiations) ? data.negotiations : []);
    }
    setLoading(false);
  }, [campaignId]);

  useEffect(() => { fetchOffers(); }, [fetchOffers]);

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
    if (!form.creatorId || !form.offeredRate) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/negotiations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          creatorId: form.creatorId,
          offeredRate: Number(form.offeredRate),
          currency: form.currency,
          notes: form.notes || null,
        }),
      });
      if (res.ok) {
        setShowCreate(false);
        setForm({ creatorId: "", offeredRate: "", currency: "USD", notes: "" });
        fetchOffers();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAction = async (offerId: string, action: "ACCEPTED" | "REJECTED" | "COUNTERED") => {
    if (action === "COUNTERED") {
      setShowCounter(offerId);
      return;
    }
    await fetch(`/api/campaigns/${campaignId}/negotiations/${offerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    fetchOffers();
  };

  const handleCounter = async () => {
    if (!showCounter || !counterRate) return;
    setSubmitting(true);
    try {
      await fetch(`/api/campaigns/${campaignId}/negotiations/${showCounter}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "COUNTERED", counterRate: Number(counterRate) }),
      });
      setShowCounter(null);
      setCounterRate("");
      fetchOffers();
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

  if (loading) return <Skeleton width="100%" height="100px" borderRadius="12px" />;

  // Group by creator
  const grouped = offers.reduce((acc, o) => {
    if (!acc[o.creatorId]) acc[o.creatorId] = [];
    acc[o.creatorId].push(o);
    return acc;
  }, {} as Record<string, Offer[]>);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "flex", alignItems: "center", gap: 8 }}>
          <Handshake size={16} /> Negotiations
        </span>
        <Button variant="primary" onClick={openCreate}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Handshake size={14} /> Make Offer</span>
        </Button>
      </div>

      {offers.length === 0 ? (
        <Card variant="outlined" style={{ padding: 24 }}>
          <EmptyState icon="🤝" title="No negotiations" description="Start by making an offer to a creator." />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {Object.entries(grouped).map(([creatorId, creatorOffers]) => (
            <Card key={creatorId} variant="outlined" style={{ padding: 16 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text-muted)", display: "block", marginBottom: 12 }}>
                Creator: {creatorId.slice(0, 8)}...
              </span>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {creatorOffers.map((offer) => (
                  <div key={offer.id} style={{
                    display: "flex", justifyContent: "space-between", alignItems: "center",
                    padding: "10px 14px", borderRadius: 8, background: "var(--cc-bg)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <div>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
                          Offered: {formatCurrency(offer.offeredRate, offer.currency)}
                        </span>
                        {offer.counterRate && (
                          <span style={{ fontSize: 13, color: "var(--cc-primary)", marginLeft: 8 }}>
                            → Counter: {formatCurrency(offer.counterRate, offer.currency)}
                          </span>
                        )}
                      </div>
                      <Badge variant={STATUS_BADGE[offer.status] ?? "neutral"}>{offer.status}</Badge>
                    </div>
                    <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                      <span style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>{new Date(offer.createdAt).toLocaleDateString()}</span>
                      {(offer.status === "PENDING" || offer.status === "COUNTERED") && (
                        <>
                          <button onClick={() => handleAction(offer.id, "ACCEPTED")} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #059669", background: "#D1FAE5", color: "#059669", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 2 }}>
                            <Check size={12} /> Accept
                          </button>
                          <button onClick={() => handleAction(offer.id, "COUNTERED")} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--cc-primary)", background: "rgba(91,91,214,0.08)", color: "var(--cc-primary)", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 2 }}>
                            <ArrowRightLeft size={12} /> Counter
                          </button>
                          <button onClick={() => handleAction(offer.id, "REJECTED")} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid #DC2626", background: "#FEE2E2", color: "#DC2626", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 2 }}>
                            <X size={12} /> Reject
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Make Offer Modal */}
      {showCreate && (
        <Modal open={true} onClose={() => setShowCreate(false)} title="Make Offer" size="md" footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button variant="primary" loading={submitting} onClick={handleCreate} disabled={!form.creatorId || !form.offeredRate}>Send Offer</Button>
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
                <Input label="Offered Rate" type="number" value={form.offeredRate} onChange={(e) => setForm(f => ({ ...f, offeredRate: e.target.value }))} placeholder="e.g. 500" required />
              </div>
              <div style={{ width: 110 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Currency</label>
                <select value={form.currency} onChange={(e) => setForm(f => ({ ...f, currency: e.target.value }))} style={selectStyle}>
                  <option>USD</option><option>EUR</option><option>GBP</option><option>INR</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Notes (optional)</label>
              <textarea value={form.notes} onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any additional context..." rows={2} style={{ ...selectStyle, resize: "vertical" as const }} />
            </div>
          </div>
        </Modal>
      )}

      {/* Counter Modal */}
      {showCounter && (
        <Modal open={true} onClose={() => { setShowCounter(null); setCounterRate(""); }} title="Counter Offer" size="sm" footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => { setShowCounter(null); setCounterRate(""); }}>Cancel</Button>
            <Button variant="primary" loading={submitting} onClick={handleCounter} disabled={!counterRate}>Send Counter</Button>
          </div>
        }>
          <Input label="Counter Rate" type="number" value={counterRate} onChange={(e) => setCounterRate(e.target.value)} placeholder="e.g. 750" required />
        </Modal>
      )}
    </div>
  );
}
