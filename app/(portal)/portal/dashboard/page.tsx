"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge, StatCard, Skeleton, EmptyState, Button, Avatar } from "@pratham7711/ui";
import { DollarSign, Send, CheckCircle, TrendingUp, Search, LogOut } from "lucide-react";
import Link from "next/link";

type DashboardData = {
  user: { name: string; handle: string; avatarUrl: string | null; lifetimeEarnings: number; averageRating: number; reviewCount: number; cpm: number };
  stats: { totalProposals: number; pendingProposals: number; acceptedProposals: number; lifetimeEarnings: number };
  recentProposals: { id: string; proposedRate: number; currency: string; status: string; createdAt: string; campaign: { id: string; title: string; budget: number | null; currency: string; org: { name: string } } }[];
};

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  ACCEPTED: "success",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
};

function formatCurrency(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
}

export default function PortalDashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/portal/dashboard")
      .then(r => { if (r.status === 401) { router.push("/portal/login"); return null; } return r.json(); })
      .then(d => { if (d) setData(d); })
      .finally(() => setLoading(false));
  }, [router]);

  const handleLogout = async () => {
    await fetch("/api/portal/auth/logout", { method: "POST" });
    router.push("/portal/login");
  };

  if (loading) return (
    <div className="rsp-page" style={{ maxWidth: 960 }}>
      <Skeleton width="200px" height="32px" />
      <div className="rsp-grid-tiles" style={{ marginTop: 24 }}>
        {[1, 2, 3, 4].map(i => <Skeleton key={i} height="80px" borderRadius="10px" />)}
      </div>
    </div>
  );

  if (!data) return null;

  return (
    <div className="rsp-page" style={{ maxWidth: 960 }}>
      {/* Header */}
      <div className="rsp-header">
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <Avatar name={data.user.name} size="lg" />
          <div style={{ minWidth: 0 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--cc-text)" }}>Welcome, {data.user.name}</h1>
            <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>@{data.user.handle}</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/portal/discover">
            <Button variant="primary">
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Search size={14} /> Discover Gigs</span>
            </Button>
          </Link>
          <Button variant="secondary" onClick={handleLogout}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}><LogOut size={14} /> Logout</span>
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="rsp-grid-tiles" style={{ marginBottom: 32 }}>
        <StatCard value={formatCurrency(data.stats.lifetimeEarnings)} label="Lifetime Earnings" icon={<DollarSign size={18} />} />
        <StatCard value={String(data.stats.totalProposals)} label="Total Proposals" icon={<Send size={18} />} />
        <StatCard value={String(data.stats.acceptedProposals)} label="Accepted" icon={<CheckCircle size={18} />} />
        <StatCard value={data.user.averageRating > 0 ? `${data.user.averageRating.toFixed(1)} / 5` : "—"} label={`Rating (${data.user.reviewCount} reviews)`} icon={<TrendingUp size={18} />} />
      </div>

      {/* Recent Proposals */}
      <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>Recent Proposals</h2>
        <Link href="/portal/proposals" style={{ fontSize: 13, color: "var(--cc-primary)", textDecoration: "none", fontWeight: 600 }}>View all</Link>
      </div>

      {data.recentProposals.length === 0 ? (
        <Card variant="outlined" style={{ padding: 24 }}>
          <EmptyState icon="📨" title="No proposals yet" description="Browse open campaigns and submit your first proposal." action={
            <Link href="/portal/discover"><Button variant="primary">Discover Campaigns</Button></Link>
          } />
        </Card>
      ) : (
        <Card variant="solid" noPadding>
          <div className="rsp-table-wrap">
          <div style={{ minWidth: 560 }}>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 120px 100px 100px 120px",
            gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
          }}>
            {["Campaign", "Org", "Your Rate", "Status", "Date"].map(h => (
              <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
            ))}
          </div>
          {data.recentProposals.map((p, i) => (
            <div key={p.id} style={{
              display: "grid", gridTemplateColumns: "1fr 120px 100px 100px 120px",
              gap: 12, padding: "14px 24px", alignItems: "center",
              borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
            }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{p.campaign.title}</span>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{p.campaign.org.name}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>{formatCurrency(p.proposedRate, p.currency)}</span>
              <Badge variant={STATUS_BADGE[p.status] ?? "neutral"}>{p.status}</Badge>
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{new Date(p.createdAt).toLocaleDateString()}</span>
            </div>
          ))}
          </div>
          </div>
        </Card>
      )}
    </div>
  );
}
