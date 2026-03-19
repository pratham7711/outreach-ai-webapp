"use client";

import { useState } from "react";
import { Plus, Search, MoreVertical, Share2 } from "lucide-react";
import Link from "next/link";

type Campaign = {
  id: string;
  title: string;
  status: string;
  budget: number | null;
  currency: string;
  client?: { name: string } | null;
  _count: { activations: number; posts: number };
};

export default function CampaignsClient({
  campaigns,
  stats,
}: {
  campaigns: Campaign[];
  stats: {
    total: number;
    active: number;
    creatorCount: number;
    totalBudget: number;
  };
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("ALL");

  const filtered = campaigns.filter((c) => {
    const matchesSearch =
      c.title.toLowerCase().includes(search.toLowerCase()) ||
      (c.client?.name ?? "").toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "ALL" || c.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  const statuses = ["ALL", "DRAFT", "IN_PROGRESS", "COMPLETE", "PENDING"];
  const statusLabels: Record<string, { label: string; icon: string }> = {
    ALL: { label: "All", icon: "" },
    DRAFT: { label: "Draft", icon: "📝" },
    PENDING: { label: "Pending", icon: "⏳" },
    IN_PROGRESS: { label: "Active", icon: "✦" },
    COMPLETE: { label: "Complete", icon: "✓" },
    CANCELLED: { label: "Canceled", icon: "✕" },
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--cc-bg)" }}>
      {/* Header */}
      <div style={{ marginBottom: 32, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
            Campaigns
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            {stats.total} Active Campaigns
          </p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              borderRadius: 12,
              background: "var(--cc-primary)",
              color: "white",
              border: "none",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              transition: "opacity 0.2s",
            }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.opacity = "0.9")}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.opacity = "1")}
          >
            <Plus size={16} />
            New Campaign
          </button>
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 16px",
              borderRadius: 12,
              background: "var(--cc-card)",
              color: "var(--cc-text)",
              border: "1px solid var(--cc-border)",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
            onMouseEnter={(e) => {
              (e.target as HTMLElement).style.borderColor = "var(--cc-primary)";
            }}
            onMouseLeave={(e) => {
              (e.target as HTMLElement).style.borderColor = "var(--cc-border)";
            }}
          >
            📁 Folders
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div style={{ marginBottom: 24, display: "flex", gap: 12 }}>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 14px",
            borderRadius: 12,
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            transition: "all 0.2s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--cc-primary)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--cc-border)";
          }}
        >
          <Search size={16} style={{ color: "var(--cc-text-muted)", flexShrink: 0 }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Campaigns"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              fontSize: 14,
              color: "var(--cc-text)",
            }}
          />
        </div>

        {/* Status Filter Dropdowns */}
        <select
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            color: "var(--cc-text)",
            fontSize: 14,
            cursor: "pointer",
            outline: "none",
            transition: "all 0.2s",
          }}
        >
          <option value="">Campaign Status</option>
          <option value="DRAFT">Draft</option>
          <option value="IN_PROGRESS">In Progress</option>
          <option value="COMPLETE">Complete</option>
        </select>
        <select
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            color: "var(--cc-text)",
            fontSize: 14,
            cursor: "pointer",
            outline: "none",
          }}
        >
          <option value="">Team Member</option>
        </select>
        <select
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            color: "var(--cc-text)",
            fontSize: 14,
            cursor: "pointer",
            outline: "none",
          }}
        >
          <option value="">Tags</option>
        </select>
        <select
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            color: "var(--cc-text)",
            fontSize: 14,
            cursor: "pointer",
            outline: "none",
          }}
        >
          <option value="">Client</option>
        </select>
        <select
          style={{
            padding: "10px 14px",
            borderRadius: 12,
            background: "var(--cc-card)",
            border: "1px solid var(--cc-border)",
            color: "var(--cc-text)",
            fontSize: 14,
            cursor: "pointer",
            outline: "none",
          }}
        >
          <option value="">Creation Date</option>
        </select>
      </div>

      {/* Status Tabs */}
      <div style={{ marginBottom: 24, display: "flex", gap: 8 }}>
        {statuses.map((status) => (
          <button
            key={status}
            onClick={() => setStatusFilter(status)}
            style={{
              padding: "8px 16px",
              borderRadius: 20,
              background: statusFilter === status ? "var(--cc-primary)" : "var(--cc-card)",
              color: statusFilter === status ? "white" : "var(--cc-text-muted)",
              border: statusFilter === status ? "none" : "1px solid var(--cc-border)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.2s",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {statusLabels[status].icon && <span>{statusLabels[status].icon}</span>}
            {statusLabels[status].label}
          </button>
        ))}
      </div>

      {/* Campaign List */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {filtered.length === 0 ? (
          <div
            style={{
              textAlign: "center",
              padding: "60px 20px",
              color: "var(--cc-text-muted)",
            }}
          >
            <p>No campaigns found</p>
          </div>
        ) : (
          filtered.map((campaign) => (
            <Link key={campaign.id} href={`/campaigns/${campaign.id}`}>
              <div
                style={{
                  background: "var(--cc-card)",
                  border: "1px solid var(--cc-border)",
                  borderRadius: 12,
                  padding: "16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  transition: "all 0.2s",
                  cursor: "pointer",
                }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--cc-primary)";
                  (e.currentTarget as HTMLElement).style.boxShadow =
                    "0 4px 12px rgba(91, 91, 214, 0.1)";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLElement).style.borderColor = "var(--cc-border)";
                  (e.currentTarget as HTMLElement).style.boxShadow = "none";
                }}
              >
                {/* Album Art */}
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 8,
                    background: `linear-gradient(135deg, #5B5BD6 0%, #7B7DE8 100%)`,
                    flexShrink: 0,
                  }}
                />

                {/* Name + Updated */}
                <div style={{ flex: 1 }}>
                  <p
                    style={{
                      fontSize: 14,
                      fontWeight: 600,
                      color: "var(--cc-text)",
                      marginBottom: 4,
                    }}
                  >
                    {campaign.title}
                  </p>
                  <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                    Last Updated 2 hours ago
                  </p>
                </div>

                {/* Stats */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 1fr 1fr",
                    gap: 16,
                    paddingRight: 16,
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>Budget</p>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                      N/A
                    </p>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>Creators</p>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                      {campaign._count.activations}
                    </p>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>Posts</p>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                      {campaign._count.posts}
                    </p>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>Team</p>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>1</p>
                  </div>
                </div>

                {/* Status Badge */}
                <div
                  style={{
                    padding: "6px 12px",
                    borderRadius: 20,
                    background: "var(--cc-primary)",
                    color: "white",
                    fontSize: 12,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  In-Progress
                </div>

                {/* Share + Menu */}
                <div style={{ display: "flex", gap: 8, flexShrink: 0 }} onClick={(e) => e.preventDefault()}>
                  <button
                    style={{
                      padding: "8px 12px",
                      borderRadius: 8,
                      background: "var(--cc-card)",
                      border: "1px solid var(--cc-border)",
                      color: "var(--cc-text)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 500,
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor = "var(--cc-primary)";
                      (e.currentTarget as HTMLElement).style.color = "var(--cc-primary)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.borderColor = "var(--cc-border)";
                      (e.currentTarget as HTMLElement).style.color = "var(--cc-text)";
                    }}
                  >
                    <Share2 size={14} />
                    Share
                  </button>
                  <button
                    style={{
                      padding: "8px",
                      borderRadius: 8,
                      background: "transparent",
                      border: "none",
                      color: "var(--cc-text-muted)",
                      cursor: "pointer",
                      transition: "color 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.color = "var(--cc-text)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.color = "var(--cc-text-muted)";
                    }}
                  >
                    <MoreVertical size={16} />
                  </button>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
