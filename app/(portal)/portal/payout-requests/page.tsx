"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Button, StatCard, Skeleton, EmptyState, Input, Modal } from "@pratham7711/ui";
import { toast } from "sonner";
import { DollarSign, Clock, CheckCircle, XCircle, Plus } from "lucide-react";

type PayoutRequest = {
  id: string;
  amount: number;
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

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
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
        body: JSON.stringify({ campaignId: selectedCampaignId, amount: numAmount }),
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

  // Stats
  const totalRequested = requests.reduce((sum, r) => sum + r.amount, 0);
  const pendingCount = requests.filter((r) => r.status === "PENDING").length;
  const approvedCount = requests.filter((r) => r.status === "APPROVED").length;
  const rejectedCount = requests.filter((r) => r.status === "REJECTED").length;

  if (loading) {
    return (
      <div className="rsp-page" style={{ maxWidth: 960 }}>
        <Skeleton width="200px" height="32px" />
        <div className="rsp-grid-tiles" style={{ marginTop: 24 }}>
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
      <div className="rsp-grid-tiles" style={{ marginBottom: 32 }}>
        <StatCard
          value={formatCurrency(totalRequested)}
          label="Total Requested"
          icon={<DollarSign size={18} />}
        />
        <StatCard
          value={String(pendingCount)}
          label="Pending"
          icon={<Clock size={18} />}
        />
        <StatCard
          value={String(approvedCount)}
          label="Approved"
          icon={<CheckCircle size={18} />}
        />
        <StatCard
          value={String(rejectedCount)}
          label="Rejected"
          icon={<XCircle size={18} />}
        />
      </div>

      {/* Requests List */}
      {requests.length === 0 ? (
        <Card variant="outlined" style={{ padding: 24 }}>
          <EmptyState
            icon="💸"
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
                {formatCurrency(req.amount, req.currency)}
              </span>
              <Badge variant={STATUS_BADGE[req.status] ?? "neutral"}>
                {req.status}
              </Badge>
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                {new Date(req.createdAt).toLocaleDateString()}
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
              <select
                value={selectedCampaignId}
                onChange={(e) => setSelectedCampaignId(e.target.value)}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  borderRadius: 8,
                  border: "1px solid var(--cc-border)",
                  background: "var(--cc-card)",
                  color: "var(--cc-text)",
                  fontSize: 14,
                  outline: "none",
                }}
              >
                <option value="">Select a campaign</option>
                {campaigns.map((p) => (
                  <option key={p.campaign.id} value={p.campaign.id}>
                    {p.campaign.title} ({formatCurrency(p.proposedRate, p.currency)})
                  </option>
                ))}
              </select>
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
