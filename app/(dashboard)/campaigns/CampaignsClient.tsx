"use client";

import { useState } from "react";
import { Plus, Search, MoreVertical, Share2, FolderOpen } from "lucide-react";
import Link from "next/link";
import { Button, Card, Badge, StatCard } from "@pratham7711/ui";

const EmptyState = ({ icon, title, description, action }: { icon: string; title: string; description?: string; action?: React.ReactNode }) => (
  <div style={{ textAlign: "center", padding: "48px 24px" }}>
    <div style={{ fontSize: 36, marginBottom: 12 }}>{icon}</div>
    <h3 style={{ fontSize: 16, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>{title}</h3>
    {description && <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 16 }}>{description}</p>}
    {action}
  </div>
);
const SearchInput = ({ value, onChange, placeholder }: { value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; placeholder?: string }) => (
  <div style={{ position: "relative" }}>
    <Search size={16} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--cc-text-muted)", pointerEvents: "none" }} />
    <input value={value} onChange={onChange} placeholder={placeholder} style={{ width: "100%", padding: "9px 12px 9px 36px", border: "1px solid var(--cc-border)", borderRadius: 8, fontSize: 14, background: "var(--cc-card)", color: "var(--cc-text)", outline: "none" }} />
  </div>
);
import NewCampaignModal from "@/components/modals/NewCampaignModal";

type Campaign = {
  id: string;
  title: string;
  status: string;
  budget: number | null;
  currency: string;
  client?: { name: string } | null;
  _count: { activations: number; posts: number };
};

type Client = { id: string; name: string };

const STATUS_TABS = [
  { key: "ALL",         label: "All",      bg: "#F3F4F6", color: "#374151" },
  { key: "PENDING",     label: "Pending",  bg: "#FEF3C7", color: "#D97706" },
  { key: "IN_PROGRESS", label: "Active",   bg: "#EEF2FF", color: "#4F46E5" },
  { key: "COMPLETE",    label: "Complete", bg: "#D1FAE5", color: "#059669" },
  { key: "CANCELLED",   label: "Canceled", bg: "#FEE2E2", color: "#DC2626" },
];

const STATUS_BADGE_VARIANT: Record<string, "warning" | "accent" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  IN_PROGRESS: "accent",
  COMPLETE: "success",
  CANCELLED: "danger",
  DRAFT: "neutral",
};

function formatCurrency(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n}`;
}

export default function CampaignsClient({
  campaigns,
  stats,
  clients,
}: {
  campaigns: Campaign[];
  stats: { total: number; active: number; creatorCount: number; totalBudget: number };
  clients: Client[];
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [showModal, setShowModal] = useState(false);

  const filtered = campaigns.filter((c) => {
    const matchesSearch =
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      (c.client?.name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "ALL" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div style={{ padding: "32px 40px 40px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>Campaigns</h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>Manage and track your influencer campaigns</p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <Button variant="secondary" iconLeft={<FolderOpen size={15} />}>Folders</Button>
          <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowModal(true)}>New Campaign</Button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, marginBottom: 32 }}>
        <StatCard value={String(stats.total)} label="Total Campaigns" />
        <StatCard value={String(stats.active)} label="Active" />
        <StatCard value={String(stats.creatorCount)} label="Creator Reach" />
        <StatCard value={stats.totalBudget ? formatCurrency(stats.totalBudget) : "$0"} label="Total Budget" />
      </div>

      {/* Search + Filters */}
      <div style={{ marginBottom: 24, display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search campaigns..." />
        </div>
      </div>

      {/* Status Tabs */}
      <div style={{ marginBottom: 24, display: "flex", gap: 8 }}>
        {STATUS_TABS.map((tab) => {
          const isSelected = statusFilter === tab.key;
          return (
            <button
              key={tab.key}
              onClick={() => setStatusFilter(tab.key)}
              style={{
                padding: "6px 14px",
                borderRadius: 20,
                background: isSelected ? tab.bg : "transparent",
                color: isSelected ? tab.color : "#9CA3AF",
                border: "none",
                fontSize: 13,
                fontWeight: isSelected ? 600 : 500,
                cursor: "pointer",
              }}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Campaign List */}
      <Card variant="solid" noPadding>
        {filtered.length === 0 ? (
          <div style={{ padding: "40px 0" }}>
            <EmptyState
              icon="🎯"
              title="No campaigns yet"
              description="Create your first campaign to get started"
              action={
                <Button variant="primary" iconLeft={<Plus size={16} />} onClick={() => setShowModal(true)}>
                  New Campaign
                </Button>
              }
            />
          </div>
        ) : (
          <div>
            {/* Table header */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 120px 100px 120px 100px 120px", gap: 16, padding: "12px 20px", borderBottom: "1px solid var(--cc-border)", background: "#F9FAFB" }}>
              {["Campaign", "Status", "Budget", "Client", "Activations", "Actions"].map((h) => (
                <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-muted)" }}>{h}</span>
              ))}
            </div>
            {filtered.map((campaign, i) => (
              <Link key={campaign.id} href={`/campaigns/${campaign.id}`} style={{ textDecoration: "none" }}>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 120px 100px 120px 100px 120px",
                    gap: 16,
                    padding: "14px 20px",
                    alignItems: "center",
                    borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                    cursor: "pointer",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = "#F9FAFB"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = "transparent"; }}
                >
                  {/* Campaign name */}
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <div style={{ width: 40, height: 40, borderRadius: 8, background: "linear-gradient(135deg, #5B5BD6 0%, #7B7DE8 100%)", flexShrink: 0 }} />
                    <div>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", marginBottom: 2 }}>{campaign.title}</p>
                      <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>Last updated 2 hours ago</p>
                    </div>
                  </div>
                  {/* Status */}
                  <Badge variant={STATUS_BADGE_VARIANT[campaign.status] ?? "neutral"} dot>
                    {campaign.status.replace("_", " ")}
                  </Badge>
                  {/* Budget */}
                  <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                    {campaign.budget ? formatCurrency(campaign.budget) : "—"}
                  </span>
                  {/* Client */}
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                    {campaign.client?.name ?? "—"}
                  </span>
                  {/* Activations */}
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                    {campaign._count.activations}
                  </span>
                  {/* Actions */}
                  <div style={{ display: "flex", gap: 8 }} onClick={(e) => e.preventDefault()}>
                    <button
                      style={{ padding: "5px 12px", borderRadius: 20, background: "#1E1B4B", color: "white", border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600 }}
                    >
                      <Share2 size={12} /> Share
                    </button>
                    <button style={{ padding: 6, borderRadius: 6, background: "transparent", border: "none", color: "var(--cc-text-muted)", cursor: "pointer" }}>
                      <MoreVertical size={15} />
                    </button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {showModal && <NewCampaignModal clients={clients} onClose={() => setShowModal(false)} />}
    </div>
  );
}
