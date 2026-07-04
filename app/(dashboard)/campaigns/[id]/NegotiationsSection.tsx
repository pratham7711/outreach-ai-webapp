"use client";

import React, { useState, useEffect, useCallback } from "react";
import { Card, Badge, Button, Input, Modal, EmptyState, Skeleton, Tag } from "@pratham7711/ui";
import { Handshake, Check, X, ArrowRightLeft, Sparkles } from "lucide-react";

type Offer = {
  id: string;
  creatorId: string;
  offeredRate: number;
  counterRate: number | null;
  aiCounterRate: number | null;
  finalRate: number | null;
  aiRound: number;
  currency: string;
  status: string;
  notes: string | null;
  createdAt: string;
};

type Aggregate = { acceptedTotal: number; pendingEstimate: number };

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

function standingRate(o: Offer): number {
  return o.finalRate ?? o.aiCounterRate ?? o.counterRate ?? o.offeredRate;
}

export default function NegotiationsSection({
  campaignId,
  platformFeeMinor = 0,
}: {
  campaignId: string;
  platformFeeMinor?: number;
}) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [aggregate, setAggregate] = useState<Aggregate>({ acceptedTotal: 0, pendingEstimate: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showBatch, setShowBatch] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [form, setForm] = useState({ creatorId: "", offeredRate: "", currency: "USD", notes: "" });
  const [batch, setBatch] = useState<{ creatorIds: string[]; offeredRate: string; currency: string }>({
    creatorIds: [],
    offeredRate: "",
    currency: "USD",
  });

  const fetchOffers = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/negotiations`);
      if (!res.ok) {
        setError("Failed to load negotiations.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setOffers(Array.isArray(data.negotiations) ? data.negotiations : []);
      if (data.aggregate) setAggregate(data.aggregate);
    } catch {
      setError("Failed to load negotiations.");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  const loadCreators = useCallback(async () => {
    if (creators.length > 0) return;
    const res = await fetch("/api/creators");
    if (res.ok) {
      const data = await res.json();
      setCreators((data.creators ?? data).map((c: any) => ({ id: c.id, name: c.name, handle: c.handle })));
    }
  }, [creators.length]);

  const openCreate = async () => {
    setShowCreate(true);
    await loadCreators();
  };

  const openBatch = async () => {
    setBatch({ creatorIds: [], offeredRate: "", currency: "USD" });
    setShowBatch(true);
    await loadCreators();
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

  const handleStartBatch = async () => {
    if (batch.creatorIds.length === 0 || !batch.offeredRate) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/negotiations/start-batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignId,
          creatorIds: batch.creatorIds,
          offeredRate: Number(batch.offeredRate),
          currency: batch.currency,
        }),
      });
      if (res.ok) {
        setShowBatch(false);
        fetchOffers();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleApprove = async (offerId: string) => {
    setActing(offerId);
    try {
      await fetch(`/api/negotiations/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId }),
      });
      fetchOffers();
    } finally {
      setActing(null);
    }
  };

  const handleReject = async (offerId: string) => {
    setActing(offerId);
    try {
      await fetch(`/api/negotiations/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId }),
      });
      fetchOffers();
    } finally {
      setActing(null);
    }
  };

  const toggleBatchCreator = (id: string) => {
    setBatch((b) => ({
      ...b,
      creatorIds: b.creatorIds.includes(id) ? b.creatorIds.filter((x) => x !== id) : [...b.creatorIds, id],
    }));
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

  const creatorName = (id: string) => {
    const c = creators.find((x) => x.id === id);
    return c ? `${c.name} (@${c.handle})` : `${id.slice(0, 8)}...`;
  };

  const platformFee = platformFeeMinor > 0 ? platformFeeMinor / 100 : 0;
  const currency = offers[0]?.currency ?? "USD";

  if (loading) return <Skeleton width="100%" height="120px" borderRadius="12px" />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
        <span
          style={{
            fontWeight: 700,
            fontSize: 15,
            color: "var(--cc-text)",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Handshake size={16} /> Negotiations
        </span>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button variant="secondary" onClick={openBatch}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Sparkles size={14} /> Start AI negotiation
            </span>
          </Button>
          <Button variant="primary" onClick={openCreate}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Handshake size={14} /> Make Offer
            </span>
          </Button>
        </div>
      </div>

      {/* Running budget line */}
      {offers.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 24,
            padding: "12px 16px",
            marginBottom: 12,
            borderRadius: 10,
            background: "var(--cc-bg)",
            border: "1px solid var(--cc-border)",
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            Accepted total:{" "}
            <strong style={{ color: "var(--cc-text)" }}>{formatCurrency(aggregate.acceptedTotal, currency)}</strong>
          </span>
          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            Pending estimate:{" "}
            <strong style={{ color: "var(--cc-text)" }}>{formatCurrency(aggregate.pendingEstimate, currency)}</strong>
          </span>
          {platformFee > 0 && (
            <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
              + Platform fee: <strong style={{ color: "var(--cc-text)" }}>{formatCurrency(platformFee, currency)}</strong>
            </span>
          )}
        </div>
      )}

      {error ? (
        <Card variant="outlined" style={{ padding: 24 }}>
          <EmptyState icon="⚠️" title="Couldn't load negotiations" description={error} />
          <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
            <Button variant="secondary" onClick={fetchOffers}>
              Retry
            </Button>
          </div>
        </Card>
      ) : offers.length === 0 ? (
        <Card variant="outlined" style={{ padding: 24 }}>
          <EmptyState icon="🤝" title="No negotiations" description="Start by making an offer to a creator." />
        </Card>
      ) : (
        <Card variant="solid" noPadding style={{ overflowX: "auto" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.4fr 100px 110px 120px 120px 90px 110px 160px",
              minWidth: 940,
              gap: 8,
              padding: "12px 16px",
              borderBottom: "1px solid var(--cc-border)",
              background: "var(--cc-bg)",
            }}
          >
            {["Creator", "Offered", "Creator", "AI counter", "Standing", "AI round", "Status", "Action"].map((h) => (
              <span
                key={h}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--cc-text-subtle)",
                }}
              >
                {h}
              </span>
            ))}
          </div>
          {offers.map((offer, i) => (
            <div
              key={offer.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1.4fr 100px 110px 120px 120px 90px 110px 160px",
                minWidth: 940,
                gap: 8,
                padding: "12px 16px",
                alignItems: "center",
                borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                {creatorName(offer.creatorId)}
              </span>
              <span style={{ fontSize: 13, color: "var(--cc-text)" }}>
                {formatCurrency(offer.offeredRate, offer.currency)}
              </span>
              <span style={{ fontSize: 13, color: "var(--cc-text)" }}>
                {offer.counterRate != null ? formatCurrency(offer.counterRate, offer.currency) : "—"}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                {offer.aiCounterRate != null ? (
                  <>
                    <span style={{ fontSize: 13, color: "var(--cc-primary)" }}>
                      {formatCurrency(offer.aiCounterRate, offer.currency)}
                    </span>
                    <Tag variant="accent">AI</Tag>
                  </>
                ) : (
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>—</span>
                )}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>
                {formatCurrency(standingRate(offer), offer.currency)}
              </span>
              <Tag variant={offer.aiRound >= 1 ? "accent" : "neutral"} outlined={offer.aiRound < 1}>
                {offer.aiRound}/1
              </Tag>
              <Badge variant={STATUS_BADGE[offer.status] ?? "neutral"}>{offer.status}</Badge>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                {(offer.status === "PENDING" || offer.status === "COUNTERED") && (
                  <>
                    <button
                      onClick={() => handleApprove(offer.id)}
                      disabled={acting === offer.id}
                      title={`Approve at ${formatCurrency(standingRate(offer), offer.currency)}`}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid #059669",
                        background: "#D1FAE5",
                        color: "#059669",
                        cursor: acting === offer.id ? "wait" : "pointer",
                        fontSize: 11,
                        display: "flex",
                        alignItems: "center",
                        gap: 2,
                      }}
                    >
                      <Check size={12} /> Approve
                    </button>
                    <button
                      onClick={() => handleReject(offer.id)}
                      disabled={acting === offer.id}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid #DC2626",
                        background: "#FEE2E2",
                        color: "#DC2626",
                        cursor: acting === offer.id ? "wait" : "pointer",
                        fontSize: 11,
                        display: "flex",
                        alignItems: "center",
                        gap: 2,
                      }}
                    >
                      <X size={12} /> Reject
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Make Offer Modal (single creator) */}
      {showCreate && (
        <Modal
          open={true}
          onClose={() => setShowCreate(false)}
          title="Make Offer"
          size="md"
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => setShowCreate(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={submitting}
                onClick={handleCreate}
                disabled={!form.creatorId || !form.offeredRate}
              >
                Send Offer
              </Button>
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>
                Creator
              </label>
              <select
                value={form.creatorId}
                onChange={(e) => setForm((f) => ({ ...f, creatorId: e.target.value }))}
                style={selectStyle}
              >
                <option value="">Select creator...</option>
                {creators.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} (@{c.handle})
                  </option>
                ))}
              </select>
            </div>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <Input
                  label="Offered Rate"
                  type="number"
                  value={form.offeredRate}
                  onChange={(e) => setForm((f) => ({ ...f, offeredRate: e.target.value }))}
                  placeholder="e.g. 500"
                  required
                />
              </div>
              <div style={{ width: 110 }}>
                <label
                  style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}
                >
                  Currency
                </label>
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
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>
                Notes (optional)
              </label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                placeholder="Any additional context..."
                rows={2}
                style={{ ...selectStyle, resize: "vertical" as const }}
              />
            </div>
          </div>
        </Modal>
      )}

      {/* Start AI negotiation Modal (multi-select) */}
      {showBatch && (
        <Modal
          open={true}
          onClose={() => setShowBatch(false)}
          title="Start AI negotiation"
          size="md"
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => setShowBatch(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={submitting}
                onClick={handleStartBatch}
                disabled={batch.creatorIds.length === 0 || !batch.offeredRate}
              >
                Send offers ({batch.creatorIds.length})
              </Button>
            </div>
          }
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div style={{ display: "flex", gap: 12 }}>
              <div style={{ flex: 1 }}>
                <Input
                  label="Offered Rate (per creator)"
                  type="number"
                  value={batch.offeredRate}
                  onChange={(e) => setBatch((b) => ({ ...b, offeredRate: e.target.value }))}
                  placeholder="e.g. 500"
                  required
                />
              </div>
              <div style={{ width: 110 }}>
                <label
                  style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}
                >
                  Currency
                </label>
                <select
                  value={batch.currency}
                  onChange={(e) => setBatch((b) => ({ ...b, currency: e.target.value }))}
                  style={selectStyle}
                >
                  <option>USD</option>
                  <option>EUR</option>
                  <option>GBP</option>
                  <option>INR</option>
                </select>
              </div>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>
                Creators
              </label>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 8,
                  maxHeight: 220,
                  overflowY: "auto",
                  padding: 4,
                }}
              >
                {creators.length === 0 ? (
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>No creators available.</span>
                ) : (
                  creators.map((c) => {
                    const selected = batch.creatorIds.includes(c.id);
                    return (
                      <Tag
                        key={c.id}
                        variant={selected ? "accent" : "neutral"}
                        outlined={!selected}
                        clickable
                        onClick={() => toggleBatchCreator(c.id)}
                        style={{ cursor: "pointer", fontWeight: selected ? 600 : 400 }}
                      >
                        {c.name}
                      </Tag>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
