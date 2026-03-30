"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, Button, EmptyState, Skeleton } from "@pratham7711/ui";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";

type Proposal = {
  id: string;
  proposedRate: number;
  currency: string;
  status: string;
  createdAt: string;
  campaign: {
    id: string;
    title: string;
    budget: number | null;
    currency: string;
    status: string;
    org: { name: string; logoUrl: string | null };
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

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export default function PortalProposalsPage() {
  const router = useRouter();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("ALL");

  const fetchProposals = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    const res = await fetch(`/api/portal/proposals?${params}`);
    if (res.status === 401) { router.push("/portal/login"); return; }
    if (res.ok) {
      const data = await res.json();
      setProposals(data.proposals);
    }
    setLoading(false);
  }, [statusFilter, router]);

  useEffect(() => { fetchProposals(); }, [fetchProposals]);

  if (loading) return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 32 }}>
      <Skeleton width="200px" height="32px" />
      <Skeleton width="100%" height="300px" borderRadius="12px" />
    </div>
  );

  return (
    <div style={{ maxWidth: 960, margin: "0 auto", padding: 32 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <Link href="/portal/dashboard" style={{ color: "var(--cc-text-muted)", textDecoration: "none", display: "flex", alignItems: "center" }}>
          <ArrowLeft size={16} />
        </Link>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)" }}>My Proposals</h1>
      </div>
      <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 24 }}>Track all your campaign proposals</p>

      {/* Status filter tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
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
        <EmptyState icon="📨" title="No proposals" description="You haven't submitted any proposals yet." action={
          <Link href="/portal/discover"><Button variant="primary">Discover Campaigns</Button></Link>
        } />
      ) : (
        <Card variant="solid" noPadding>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 120px 100px 100px 100px 120px",
            gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
          }}>
            {["Campaign", "Org", "Budget", "Your Rate", "Status", "Date"].map(h => (
              <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
            ))}
          </div>
          {proposals.map((p, i) => (
            <div key={p.id} style={{
              display: "grid", gridTemplateColumns: "1fr 120px 100px 100px 100px 120px",
              gap: 12, padding: "14px 24px", alignItems: "center",
              borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
            }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{p.campaign.title}</span>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{p.campaign.org.name}</span>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{p.campaign.budget ? formatCurrency(p.campaign.budget, p.campaign.currency) : "—"}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>{formatCurrency(p.proposedRate, p.currency)}</span>
              <Badge variant={STATUS_BADGE[p.status] ?? "neutral"}>{p.status}</Badge>
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{new Date(p.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
