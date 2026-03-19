"use client";

import { useState } from "react";
import { Plus, Search, MoreVertical, Share2, FolderOpen, ChevronDown } from "lucide-react";
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

  const STATUS_TABS = [
    { key: "ALL",         label: "All",      icon: "",   bg: "#F3F4F6", color: "#374151" },
    { key: "PENDING",     label: "Pending",  icon: "🕐", bg: "#FEF3C7", color: "#D97706" },
    { key: "IN_PROGRESS", label: "Active",   icon: "✦",  bg: "#EEF2FF", color: "#4F46E5" },
    { key: "COMPLETE",    label: "Complete", icon: "✓",  bg: "#D1FAE5", color: "#059669" },
    { key: "CANCELLED",   label: "Canceled", icon: "✕",  bg: "#FEE2E2", color: "#DC2626" },
  ];

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
              gap: 6,
              padding: "9px 16px",
              borderRadius: 8,
              background: "white",
              color: "#5B5BD6",
              border: "1.5px solid #5B5BD6",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <Plus size={15} color="#5B5BD6" />
            New Campaign +
          </button>
          <button
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "9px 16px",
              borderRadius: 8,
              background: "#1E1B4B",
              color: "white",
              border: "none",
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <FolderOpen size={15} color="white" />
            Folders
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
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {tab.icon && <span>{tab.icon}</span>}
              {tab.label}
            </button>
          );
        })}
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
                    <p style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 2 }}>💰 Budget</p>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>N/A</p>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 2 }}>👤 Creators</p>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                      {campaign._count.activations}
                    </p>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 2 }}>📷 Posts</p>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#374151" }}>
                      {campaign._count.posts}
                    </p>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <p style={{ fontSize: 11, color: "#9CA3AF", marginBottom: 2 }}>👥 Team</p>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "#374151", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
                      <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10B981", display: "inline-block" }} />
                      1
                    </p>
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
                      padding: "6px 14px",
                      borderRadius: 20,
                      background: "#1E1B4B",
                      color: "white",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    <Share2 size={13} color="white" />
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
