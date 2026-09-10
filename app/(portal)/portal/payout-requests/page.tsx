"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Skeleton, EmptyState, Input, Modal } from "@pratham7711/ui";
import { Dropdown, MetricTile, Button } from "@/components/ds";
import { toast } from "sonner";
import { DollarSign, Clock, CheckCircle, XCircle, Plus, Banknote } from "lucide-react";
import { formatDateAbs } from "@/lib/format";

/* Field names are the API's, not invented ones. This read `amount` while
   GET /api/portal/payout-requests returns `requestedAmount`, so every row
   rendered "$NaN"; the POST below sent `{ amount }` while the route's zod
   schema requires `requestedAmount`, so the modal always 400'd. */
type PayoutRequest = {
  id: string;
  requestedAmount: number;
  currency: string;
  status: string;
  createdAt: string;
  campaign: { id: string; title: string } | null;
};

type AcceptedProposal = {
  id: string;
  proposedRate: number;
  currency: string;
  campaign: { id: string; title: string };
};

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "danger",
};

function formatCurrency(n: number, currency?: string | null) {
  const code = currency || "USD";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code }).format(n);
  } catch {
    // Intl throws RangeError on an unknown code rather than degrading.
    return `${code} ${n.toFixed(2)}`;
  }
}

export default function PortalPayoutRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<PayoutRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [campaigns, setCampaigns] = useState<AcceptedProposal[]>([]);
  const [selectedCampaignId, setSelectedCampaignId] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const fetchRequests = useCallback(async () => {
    const res = await fetch("/api/portal/payout-requests");
    if (res.status === 401) { router.push("/portal/login"); return; }
    if (res.ok) {
      const data = await res.json();
      setRequests(data.requests ?? []);
    }
    setLoading(false);
  }, [router]);

  useEffect(() => { fetchRequests(); }, [fetchRequests]);

  const openModal = async () => {
    // Fetch accepted proposals for campaign options
    try {
      const res = await fetch("/api/portal/dashboard");
      if (res.ok) {
        const data = await res.json();
        const accepted = (data.recentProposals ?? []).filter(
          (p: { status: string }) => p.status === "ACCEPTED"
        );
        setCampaigns(accepted);
      }
    } catch {
      // ignore
    }
    setSelectedCampaignId("");
    setAmount("");
    setShowModal(true);
  };

  const handleSubmit = async () => {
    if (!selectedCampaignId || !amount) {
      toast.error("Please select a campaign and enter an amount");
      return;
    }
    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      toast.error("Please enter a valid amount");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/portal/payout-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId: selectedCampaignId, requestedAmount: numAmount }),
      });
      if (res.ok) {
        toast.success("Payout request submitted");
        setShowModal(false);
        fetchRequests();
      } else {
        const data = await res.json();
        toast.error(data.error ?? "Failed to submit request");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setSubmitting(false);
    }
  };

  /* Totalled per currency and never across them: the API stamps each row with
     its campaign's currency, so one creator's list can hold USD and INR rows
     and adding those numbers together produces a figure in no currency at all. */
  const totalsByCurrency = requests.reduce<Record<string, number>>((acc, r) => {
    const code = r.currency || "USD";
    acc[code] = (acc[code] ?? 0) + r.requestedAmount;
    return acc;
  }, {});
  const totalRequestedLabel =
    Object.keys(totalsByCurrency).length === 0
      ? formatCurrency(0)
      : Object.entries(totalsByCurrency)
          .map(([code, total]) => formatCurrency(total, code))
          .join(" · ");
  const pendingCount = requests.filter((r) => r.status === "PENDING").length;
  const approvedCount = requests.filter((r) => r.status === "APPROVED").length;
  const rejectedCount = requests.filter((r) => r.status === "REJECTED").length;

  if (loading) {
    return (
      <div className="rsp-page" style={{ maxWidth: 960 }}>
        <Skeleton width="200px" height="32px" />
        <div className="rsp-grid-tiles-4" style={{ marginTop: 24 }}>
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} height="80px" borderRadius="10px" />
          ))}
        </div>
        <Skeleton width="100%" height="300px" borderRadius="12px" />
      </div>
    );
  }

  return (
    <div className="rsp-page" style={{ maxWidth: 960 }}>
      {/* Header */}
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
            Payout Requests
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            Request and track your campaign payouts
          </p>
        </div>
        <Button variant="primary" onClick={openModal}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <Plus size={14} /> Request Payout
          </span>
        </Button>
      </div>

      {/* Stats */}
      <div className="rsp-grid-tiles-4" style={{ marginBottom: 32 }}>
        <MetricTile metric="portalTotalRequested" value={totalRequestedLabel} />
        <MetricTile metric="requestsPending" label="Pending" value={String(pendingCount)} />
        <MetricTile metric="portalApproved" value={String(approvedCount)} />
        <MetricTile metric="portalRejected" value={String(rejectedCount)} />
      </div>

      {/* Requests List */}
      {requests.length === 0 ? (
        <Card variant="outlined" style={{ padding: 24 }}>
          <EmptyState
            icon={<Banknote size={32} color="var(--cc-text-subtle)" />}
            title="No payout requests"
            description="Submit a payout request for your accepted campaigns."
            action={
              <Button variant="primary" onClick={openModal}>
                Request Payout
              </Button>
            }
          />
        </Card>
      ) : (
        <Card variant="solid" noPadding>
          <div className="rsp-table-wrap">
          <div style={{ minWidth: 560 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 120px 100px 120px",
              gap: 12,
              padding: "12px 24px",
              borderBottom: "1px solid var(--cc-border)",
              background: "var(--cc-bg)",
            }}
          >
            {["Campaign", "Amount", "Status", "Date"].map((h) => (
              <span
                key={h}
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "var(--cc-text-subtle)",
                }}
              >
                {h}
              </span>
            ))}
          </div>
          {requests.map((req, i) => (
            <div
              key={req.id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 120px 100px 120px",
                gap: 12,
                padding: "14px 24px",
                alignItems: "center",
                borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
                {req.campaign?.title ?? "—"}
              </span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>
                {formatCurrency(req.requestedAmount, req.currency)}
              </span>
              <Badge variant={STATUS_BADGE[req.status] ?? "neutral"}>
                {req.status}
              </Badge>
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                {formatDateAbs(req.createdAt)}
              </span>
            </div>
          ))}
          </div>
          </div>
        </Card>
      )}

      {/* Request Payout Modal */}
      {showModal && (
        <Modal
          open={showModal}
          title="Request Payout"
          onClose={() => setShowModal(false)}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>
                Campaign
              </label>
              <Dropdown
                ariaLabel="Campaign"
                align="left"
                fullWidth
                size="md"
                value={selectedCampaignId}
                onChange={setSelectedCampaignId}
                options={[
                  { value: "", label: "Select a campaign" },
                  ...campaigns.map((p) => ({
                    value: p.campaign.id,
                    label: `${p.campaign.title} (${formatCurrency(p.proposedRate, p.currency)})`,
                  })),
                ]}
              />
            </div>
            <Input
              label="Amount"
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter amount"
            />
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
              <Button variant="secondary" onClick={() => setShowModal(false)}>
                Cancel
              </Button>
              <Button variant="primary" loading={submitting} onClick={handleSubmit}>
                Submit Request
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
