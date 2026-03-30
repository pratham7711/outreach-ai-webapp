"use client";

import { useState } from "react";
import { Plus, Search, MoreVertical, Share2, FolderOpen, ChevronDown } from "lucide-react";
import Link from "next/link";
import { Button, Card, Badge, Input, EmptyState, Avatar, Tooltip } from "@pratham7711/ui";
import CampaignWizard from "@/components/modals/CampaignWizard";

type Campaign = {
  id: string;
  title: string;
  status: string;
  budget: number | null;
  currency: string;
  client?: { name: string } | null;
  _count: { activations: number; posts: number };
  updatedAt?: string;
};

type Client = { id: string; name: string };

const STATUS_TABS = [
  { key: "ALL",         label: "All",       bg: "#F3F4F6", color: "#374151" },
  { key: "PENDING",     label: "Pending",   bg: "#FEF3C7", color: "#D97706" },
  { key: "IN_PROGRESS", label: "Active",    bg: "#EEF2FF", color: "#4F46E5" },
  { key: "COMPLETE",    label: "Complete",   bg: "#D1FAE5", color: "#059669" },
  { key: "CANCELLED",   label: "Canceled",  bg: "#FEE2E2", color: "#DC2626" },
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

function timeAgo(date?: string) {
  if (!date) return "Recently";
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
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
    <div className="cc-page-content">
      {/* Header */}
      <div style={{ marginBottom: 28, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Campaigns
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            {stats.total} Active Campaign{stats.total !== 1 ? "s" : ""}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Button variant="secondary" iconLeft={<FolderOpen size={15} />} size="sm">
            Folders
          </Button>
          <Button variant="primary" iconLeft={<Plus size={15} />} size="sm" onClick={() => setShowModal(true)}>
            New Campaign
          </Button>
        </div>
      </div>

      {/* Search Bar */}
      <div style={{ marginBottom: 20 }}>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Campaigns"
          iconLeft={<Search size={16} />}
        />
      </div>

      {/* Filter Dropdowns Row */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        {["Campaign Status", "Team Member", "Tags", "Client", "Creation Date"].map((filter) => (
          <button
            key={filter}
            className="cc-filter-tab"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "7px 14px",
              fontSize: 13,
              background: "var(--cc-card)",
              border: "1px solid var(--cc-border)",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            {filter}
            <ChevronDown size={13} />
          </button>
        ))}
      </div>

      {/* Status Tabs */}
      <div role="tablist" aria-label="Filter by campaign status" style={{ marginBottom: 24, display: "flex", gap: 6, borderBottom: "1px solid var(--cc-border)", overflowX: "auto" }}>
        {STATUS_TABS.map((tab) => {
          const isSelected = statusFilter === tab.key;
          const count = tab.key === "ALL"
            ? campaigns.length
            : campaigns.filter(c => c.status === tab.key).length;
          return (
            <button
              key={tab.key}
              role="tab"
              aria-selected={isSelected}
              onClick={() => setStatusFilter(tab.key)}
              className="cc-filter-tab"
              style={{
                padding: "10px 16px",
                borderRadius: 0,
                borderBottom: isSelected ? `2px solid ${tab.color}` : "2px solid transparent",
                background: "transparent",
                color: isSelected ? tab.color : undefined,
                fontWeight: isSelected ? 600 : 500,
                display: "flex",
                alignItems: "center",
                gap: 8,
                marginBottom: -1,
              }}
            >
              {isSelected && (
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: tab.color }} />
              )}
              {tab.label}
              {count > 0 && (
                <Badge variant={isSelected ? (STATUS_BADGE_VARIANT[tab.key] ?? "neutral") : "neutral"} size="sm">
                  {count}
                </Badge>
              )}
            </button>
          );
        })}
      </div>

      {/* Campaign List */}
      <Card variant="solid" noPadding>
        {filtered.length === 0 ? (
          <div style={{ padding: "48px 24px" }}>
            <EmptyState
              icon="🎯"
              title="No campaigns yet"
              description="Create your first campaign to get started"
              action={
                <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowModal(true)}>
                  New Campaign
                </Button>
              }
            />
          </div>
        ) : (
          <div className="cc-stagger">
            {filtered.map((campaign, i) => (
              <Link key={campaign.id} href={`/campaigns/${campaign.id}`} style={{ textDecoration: "none" }}>
                <div
                  className="cc-table-row"
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    alignItems: "center",
                    padding: "14px 20px",
                    gap: 16,
                    borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                  }}
                >
                  {/* Campaign Avatar/Thumbnail */}
                  <Avatar name={campaign.title} size="md" />

                  {/* Campaign Name + Last Updated */}
                  <div style={{ flex: 1, minWidth: 160 }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {campaign.title}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--cc-text-subtle)" }}>
                      Last updated {timeAgo(campaign.updatedAt)}
                    </p>
                  </div>

                  {/* Stats - wrap on mobile as a row of small stat blocks */}
                  <div className="hidden sm:flex items-center gap-4" style={{ flexShrink: 0 }}>
                    {/* Budget Column */}
                    <div style={{ width: 80, textAlign: "center" }}>
                      <p style={{ fontSize: 10, fontWeight: 600, color: "var(--cc-text-subtle)", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 2 }}>
                        Budget
                      </p>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
                        {campaign.budget ? formatCurrency(campaign.budget) : "N/A"}
                      </p>
                    </div>

                    {/* Creators Column */}
                    <div style={{ width: 80, textAlign: "center" }}>
                      <p style={{ fontSize: 10, fontWeight: 600, color: "var(--cc-text-subtle)", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 2 }}>
                        Creators
                      </p>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
                        {campaign._count.activations}
                      </p>
                    </div>

                    {/* Posts Column */}
                    <div style={{ width: 60, textAlign: "center" }}>
                      <p style={{ fontSize: 10, fontWeight: 600, color: "var(--cc-text-subtle)", letterSpacing: "0.5px", textTransform: "uppercase", marginBottom: 2 }}>
                        Posts
                      </p>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
                        {campaign._count.posts}
                      </p>
                    </div>

                    {/* Team Column */}
                    <div style={{ width: 60, display: "flex", justifyContent: "center" }}>
                      <div className="cc-avatar-group">
                        <Avatar name="T" size="sm" />
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div style={{ flexShrink: 0 }}>
                    <Badge variant={STATUS_BADGE_VARIANT[campaign.status] ?? "neutral"} dot>
                      {campaign.status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                    </Badge>
                  </div>

                  {/* Share + More Actions */}
                  <div className="hidden md:flex" style={{ gap: 8, flexShrink: 0 }} onClick={(e) => e.preventDefault()}>
                    <Button variant="primary" size="sm" iconLeft={<Share2 size={12} />}>
                      Share
                    </Button>
                    <Button variant="ghost" size="sm" aria-label="More actions">
                      <MoreVertical size={16} />
                    </Button>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {showModal && <CampaignWizard clients={clients} onClose={() => setShowModal(false)} />}
    </div>
  );
}
