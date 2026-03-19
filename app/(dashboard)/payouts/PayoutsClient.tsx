"use client";

import { useState } from "react";
import { Plus, Search } from "lucide-react";
import { Button, Card, Badge, StatCard, EmptyState, Input, Tag } from "@pratham7711/ui";
import AddPayoutModal from "@/components/modals/AddPayoutModal";

type Payout = {
  id: string;
  amount: number;
  status: string;
  createdAt: string;
  creator: { id: string; name: string; handle: string; platform: string };
  campaign: { id: string; title: string } | null;
};

type Creator = { id: string; name: string; handle: string };
type Campaign = { id: string; title: string };

const STATUS_BADGE_VARIANT: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  SENT: "success",
  FAILED: "danger",
};

const STATUS_TABS = ["All", "Pending", "Sent", "Failed"];

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

export default function PayoutsClient({ payouts, stats, creators, campaigns }: {
  payouts: Payout[];
  stats: { total: number; sent: number; pending: number };
  creators: Creator[];
  campaigns: Campaign[];
}) {
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");

  const filtered = payouts.filter((p) => {
    const matchSearch =
      p.creator.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.campaign?.title ?? "").toLowerCase().includes(search.toLowerCase());
    const matchStatus =
      statusFilter === "All" || p.status.toUpperCase() === statusFilter.toUpperCase();
    return matchSearch && matchStatus;
  });

  return (
    <div style={{ padding: "32px 40px 40px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Payouts</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Track and manage creator payments</p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowModal(true)}>
          Process Payout
        </Button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 32 }}>
        <StatCard value={formatCurrency(stats.sent)} label="Total Paid" />
        <StatCard value={formatCurrency(stats.pending)} label="Pending Amount" />
        <StatCard value={formatCurrency(stats.total)} label="Total Processed" />
      </div>

      {/* Search + Status Filter */}
      <div style={{ marginBottom: 24, display: "flex", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search payouts..."
            iconLeft={<Search size={16} />}
          />
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {STATUS_TABS.map((tab) => (
            <Tag
              key={tab}
              outlined={statusFilter !== tab}
              onClick={() => setStatusFilter(tab)}
              style={{ cursor: "pointer", fontWeight: statusFilter === tab ? 600 : 400 }}
            >
              {tab}
            </Tag>
          ))}
        </div>
      </div>

      {/* Table */}
      <Card variant="solid" noPadding>
        {filtered.length === 0 ? (
          <div style={{ padding: "40px 0" }}>
            <EmptyState
              icon="💸"
              title="No payouts yet"
              description="Process your first creator payment to get started"
              action={
                <Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setShowModal(true)}>
                  Process Payout
                </Button>
              }
            />
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 140px 100px 100px 100px", gap: 16, padding: "12px 20px", borderBottom: "1px solid var(--cc-border)", background: "#F9FAFB" }}>
              {["Creator", "Campaign", "Amount", "Status", "Date"].map((h) => (
                <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-muted)" }}>{h}</span>
              ))}
            </div>
            {filtered.map((p, i) => (
              <div
                key={p.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 140px 100px 100px 100px",
                  gap: 16,
                  padding: "14px 20px",
                  alignItems: "center",
                  borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                  transition: "background 0.15s",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#F9FAFB"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
              >
                {/* Creator */}
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--cc-primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "white", fontSize: 10, fontWeight: 700, flexShrink: 0 }}>
                    {p.creator.name.split(" ").map((n) => n[0]).join("").slice(0, 2)}
                  </div>
                  <div>
                    <p style={{ fontSize: 14, fontWeight: 500, color: "var(--cc-text)" }}>{p.creator.name}</p>
                    <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{p.creator.handle}</p>
                  </div>
                </div>
                {/* Campaign */}
                <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{p.campaign?.title ?? "—"}</span>
                {/* Amount */}
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{formatCurrency(p.amount)}</span>
                {/* Status */}
                <Badge variant={STATUS_BADGE_VARIANT[p.status] ?? "neutral"} dot>
                  {p.status}
                </Badge>
                {/* Date */}
                <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{new Date(p.createdAt).toLocaleDateString()}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {showModal && <AddPayoutModal creators={creators} campaigns={campaigns} onClose={() => setShowModal(false)} />}
    </div>
  );
}
