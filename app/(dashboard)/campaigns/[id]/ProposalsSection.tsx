"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Button, EmptyState, Skeleton, Avatar } from "@pratham7711/ui";
import { Check, X, Users, Star, TrendingUp } from "lucide-react";
import { toast } from "sonner";

type Proposal = {
  id: string;
  proposedRate: number;
  currency: string;
  status: string;
  createdAt: string;
  creatorUser: {
    id: string;
    name: string;
    handle: string;
    avatarUrl: string | null;
    platform: string;
    followersCount: number;
    averageViews: number;
    averageRating: number;
    reviewCount: number;
    rate: number | null;
    cpm: number;
    niches: string[];
  };
};

const STATUS_TABS = [
  { key: "ALL", label: "All", bg: "#F3F4F6", color: "#374151" },
  { key: "PENDING", label: "Pending", bg: "#FEF3C7", color: "#D97706" },
  { key: "ACCEPTED", label: "Accepted", bg: "#D1FAE5", color: "#059669" },
  { key: "REJECTED", label: "Rejected", bg: "#FEE2E2", color: "#DC2626" },
];

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  ACCEPTED: "success",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
};

function formatNumber(num: number): string {
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export default function ProposalsSection({ campaignId }: { campaignId: string }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [acting, setActing] = useState<string | null>(null);

  const fetchProposals = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    const res = await fetch(`/api/campaigns/${campaignId}/proposals?${params}`);
    if (res.ok) {
      const data = await res.json();
      setProposals(Array.isArray(data.proposals) ? data.proposals : []);
    }
    setLoading(false);
  }, [campaignId, statusFilter]);

  useEffect(() => { fetchProposals(); }, [fetchProposals]);

  const handleAction = async (proposalId: string, action: "ACCEPTED" | "REJECTED") => {
    setActing(proposalId);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/proposals/${proposalId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        if (action === "ACCEPTED" && data.activation) {
          toast.success(`Accepted! Activation created for ${proposals.find(p => p.id === proposalId)?.creatorUser.name}`);
        } else {
          toast.success(`Proposal ${action.toLowerCase()}`);
        }
        fetchProposals();
      }
    } finally {
      setActing(null);
    }
  };

  if (loading) return <Skeleton width="100%" height="120px" borderRadius="12px" />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "flex", alignItems: "center", gap: 8 }}>
          <Users size={16} /> Creator Proposals
          {proposals.length > 0 && (
            <span style={{ fontSize: 12, background: "var(--cc-bg)", borderRadius: 10, padding: "2px 8px", color: "var(--cc-text-muted)" }}>
              {proposals.filter(p => p.status === "PENDING").length} pending
            </span>
          )}
        </span>
      </div>

      {/* Status filter */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {STATUS_TABS.map(tab => (
          <button
            key={tab.key}
            onClick={() => setStatusFilter(tab.key)}
            style={{
              padding: "6px 14px", borderRadius: 20, border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer",
              background: statusFilter === tab.key ? tab.bg : "transparent",
              color: statusFilter === tab.key ? tab.color : "var(--cc-text-muted)",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {proposals.length === 0 ? (
        <Card variant="outlined" style={{ padding: 24 }}>
          <EmptyState icon="📩" title="No proposals" description="Creators will submit proposals when this campaign is listed on the marketplace." />
        </Card>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {proposals.map(p => (
            <Card key={p.id} variant="outlined" style={{ padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                <div style={{ display: "flex", gap: 12, alignItems: "start" }}>
                  <Avatar name={p.creatorUser.name} size="md" />
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                      <span style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)" }}>{p.creatorUser.name}</span>
                      <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>@{p.creatorUser.handle}</span>
                      <Badge variant="neutral" style={{ fontSize: 10 }}>{p.creatorUser.platform}</Badge>
                      <Badge variant={STATUS_BADGE[p.status] ?? "neutral"}>{p.status}</Badge>
                    </div>

                    {/* Creator stats */}
                    <div style={{ display: "flex", gap: 16, fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 8 }}>
                      <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        <Users size={12} /> {formatNumber(p.creatorUser.followersCount)} followers
                      </span>
                      <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                        <TrendingUp size={12} /> {formatNumber(p.creatorUser.averageViews)} avg views
                      </span>
                      {p.creatorUser.averageRating > 0 && (
                        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                          <Star size={12} /> {p.creatorUser.averageRating.toFixed(1)} ({p.creatorUser.reviewCount})
                        </span>
                      )}
                      {p.creatorUser.cpm > 0 && (
                        <span>CPM: ${p.creatorUser.cpm.toFixed(2)}</span>
                      )}
                    </div>

                    {/* Niches */}
                    {p.creatorUser.niches.length > 0 && (
                      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
                        {p.creatorUser.niches.map(n => (
                          <span key={n} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 10, background: "var(--cc-bg)", color: "var(--cc-text-muted)" }}>{n}</span>
                        ))}
                      </div>
                    )}

                    <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 13 }}>
                      <span style={{ color: "var(--cc-text-muted)" }}>
                        Proposed: <strong style={{ color: "var(--cc-text)", fontWeight: 700 }}>{formatCurrency(p.proposedRate, p.currency)}</strong>
                      </span>
                      {p.creatorUser.rate && (
                        <span style={{ color: "var(--cc-text-muted)" }}>
                          Usual rate: {formatCurrency(p.creatorUser.rate)}
                        </span>
                      )}
                      <span style={{ color: "var(--cc-text-muted)" }}>
                        {new Date(p.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>

                {p.status === "PENDING" && (
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <Button
                      variant="primary"
                      onClick={() => handleAction(p.id, "ACCEPTED")}
                      loading={acting === p.id}
                      style={{ fontSize: 13 }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Check size={14} /> Accept</span>
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => handleAction(p.id, "REJECTED")}
                      loading={acting === p.id}
                      style={{ fontSize: 13 }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 4 }}><X size={14} /> Reject</span>
                    </Button>
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
