"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, Input, EmptyState, Tag } from "@pratham7711/ui";
import { Modal, ModalNotice } from "@/components/ds/Modal";
import { Button, Skeleton, StatusBadge, type StatusTone } from "@/components/ds";
import { toast } from "sonner";
import { Handshake, AlertTriangle, Info } from "lucide-react";

type Offer = {
  id: string;
  campaignId: string;
  campaignTitle: string;
  orgName: string;
  offeredRate: number;
  counterRate: number | null;
  aiCounterRate: number | null;
  finalRate: number | null;
  currency: string;
  status: string;
  aiRound: number;
  createdAt: string;
};

const STATUS_TONE: Record<string, StatusTone> = {
  PENDING: "warning",
  ACCEPTED: "success",
  REJECTED: "danger",
  COUNTERED: "info",
};

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

function currentAsk(o: Offer): number {
  return o.aiCounterRate ?? o.counterRate ?? o.offeredRate;
}

export default function PortalOffersClient() {
  const router = useRouter();
  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [counterFor, setCounterFor] = useState<Offer | null>(null);
  const [counterRate, setCounterRate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchOffers = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/portal/offers");
      if (res.status === 401) {
        router.push("/portal/login");
        return;
      }
      if (!res.ok) {
        setError("Failed to load offers.");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setOffers(data.offers ?? []);
    } catch {
      setError("Failed to load offers.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  const handleAccept = async (offer: Offer) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/portal/offers/${offer.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept" }),
      });
      if (res.ok) {
        toast.success("Accepted — awaiting brand approval");
        fetchOffers();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Failed to accept");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCounter = async () => {
    if (!counterFor || !counterRate) return;
    const numRate = parseFloat(counterRate);
    if (isNaN(numRate) || numRate <= 0) {
      toast.error("Enter a valid rate");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/portal/offers/${counterFor.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "counter", counterRate: numRate }),
      });
      if (res.ok) {
        toast.success("Counter sent");
        setCounterFor(null);
        setCounterRate("");
        fetchOffers();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.error ?? "Failed to send counter");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="rsp-page" style={{ maxWidth: 960 }}>
        <Skeleton width="200px" height="32px" />
        <div style={{ display: "flex", flexDirection: "column", gap: 16, marginTop: 24 }}>
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} height="120px" radius="var(--cc-r-card)" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rsp-page" style={{ maxWidth: 960 }}>
      <div style={{ marginBottom: 32 }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Offers</h1>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
          Brand offers for your collaborations. Accept the current ask or send one counter.
        </p>
      </div>

      {error ? (
        <Card variant="outlined">
          <EmptyState icon={<AlertTriangle size={32} color="var(--cc-text-subtle)" />} title="Couldn't load offers" description={error} />
          <div style={{ display: "flex", justifyContent: "center", marginTop: 12 }}>
            <Button variant="secondary" onClick={fetchOffers}>
              Retry
            </Button>
          </div>
        </Card>
      ) : offers.length === 0 ? (
        <Card variant="outlined">
          <EmptyState icon={<Handshake size={32} color="var(--cc-text-subtle)" />} title="No offers yet" description="Brand offers will show up here when they reach out." />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {offers.map((offer) => {
            const ask = currentAsk(offer);
            const negotiated = offer.aiCounterRate != null;
            const canAct = offer.status === "PENDING" || offer.status === "COUNTERED";
            const awaitingBrand = offer.aiRound >= 1 || offer.status === "COUNTERED" || offer.finalRate != null;
            const actionable = canAct && offer.aiRound < 1;
            return (
              <Card key={offer.id} data-offer-id={offer.id} variant="solid">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <Handshake size={16} color="var(--cc-primary)" style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>{offer.campaignTitle}</span>
                    </div>
                    <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>from {offer.orgName}</span>
                  </div>
                  <StatusBadge status={offer.status} tone={STATUS_TONE[offer.status] ?? "neutral"} dot />
                </div>

                <div style={{ display: "flex", gap: 24, marginBottom: 16, flexWrap: "wrap" }}>
                  <div>
                    <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-subtle)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Original offer
                    </span>
                    <span style={{ fontSize: 15, fontWeight: 600, color: "var(--cc-text)" }}>
                      {formatCurrency(offer.offeredRate, offer.currency)}
                    </span>
                  </div>
                  {offer.counterRate != null && (
                    <div>
                      <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-subtle)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                        Your counter
                      </span>
                      <span style={{ fontSize: 15, fontWeight: 600, color: "var(--cc-text)" }}>
                        {formatCurrency(offer.counterRate, offer.currency)}
                      </span>
                    </div>
                  )}
                  <div>
                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--cc-text-subtle)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Current ask
                      {negotiated && <Tag variant="accent">negotiated</Tag>}
                    </span>
                    <span style={{ fontSize: 17, fontWeight: 700, color: "var(--cc-primary)" }}>
                      {formatCurrency(ask, offer.currency)}
                    </span>
                  </div>
                </div>

                {offer.status === "ACCEPTED" ? (
                  <span style={{ fontSize: 13, color: "var(--cc-success-fg)", fontWeight: 600 }}>
                    Deal approved at {formatCurrency(offer.finalRate ?? ask, offer.currency)}.
                  </span>
                ) : offer.status === "REJECTED" ? (
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                    The brand decided not to move forward.
                  </span>
                ) : actionable ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <Button variant="primary" loading={submitting} onClick={() => handleAccept(offer)}>
                      Accept {formatCurrency(ask, offer.currency)}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setCounterFor(offer);
                        setCounterRate("");
                      }}
                    >
                      Counter
                    </Button>
                  </div>
                ) : awaitingBrand ? (
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)", fontStyle: "italic" }}>
                    Awaiting brand decision.
                  </span>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {counterFor && (
        <Modal
          open={true}
          onClose={() => {
            setCounterFor(null);
            setCounterRate("");
          }}
          icon={Handshake}
          tone="brand"
          title="Counter Offer"
          description={`Countering ${counterFor.orgName}'s offer of ${formatCurrency(counterFor.offeredRate, counterFor.currency)}.`}
          size="sm"
          dismissible={false}
          footer={
            <div className="cc-modal-footer">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setCounterFor(null);
                  setCounterRate("");
                }}
              >
                Cancel
              </Button>
              <Button variant="primary" size="sm" loading={submitting} onClick={handleCounter} disabled={!counterRate}>
                Send Counter
              </Button>
            </div>
          }
        >
          <div className="cc-dialog-stack">
            <ModalNotice tone="info" icon={Info}>
              You get one counter — the brand may respond with a negotiated rate before deciding.
            </ModalNotice>
            <Input
              label="Your rate"
              type="number"
              value={counterRate}
              onChange={(e) => setCounterRate(e.target.value)}
              placeholder="e.g. 750"
              required
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
