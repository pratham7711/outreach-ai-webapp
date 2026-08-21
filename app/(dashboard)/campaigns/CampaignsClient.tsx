"use client";

import { useEffect, useState } from "react";
import { Plus, Search, FolderOpen, ChevronDown, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { Button, Card, Badge, Input, EmptyState, Avatar, Tooltip } from "@pratham7711/ui";
import { StatusTabs, Pagination } from "@/components/ds";
import CampaignWizard from "@/components/modals/CampaignWizard";
import { formatCompactCurrency, timeAgo } from "@/lib/format";
import { useListQuery } from "@/lib/useListQuery";
import { CAMPAIGNS_PAGE_SIZE } from "@/lib/listPageSize";

type Campaign = {
  id: string;
  title: string;
  status: string;
  budget: number | null;
  currency: string;
  client?: { name: string } | null;
  _count: { activations: number; posts: number };
  creatorCount: number;
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

/* Shared by the header and every row; the fixed status column is what stops a
   wide IN PROGRESS pill from shifting the numbers on its row. */
const CAMPAIGN_COLS = {
  "--cc-cols": "40px minmax(0, 1fr) 110px 90px 80px 60px 130px",
} as React.CSSProperties;

function formatCurrency(n: number) {
  return formatCompactCurrency(n);
}

export default function CampaignsClient({
  campaigns,
  stats,
  statusCounts,
  filteredTotal,
  page,
  q,
  status,
  clients,
}: {
  campaigns: Campaign[];
  stats: { total: number; active: number; creatorCount: number; totalBudget: number };
  statusCounts: Record<string, number>;
  filteredTotal: number;
  page: number;
  q: string;
  status: string;
  clients: Client[];
}) {
  const [search, setSearch] = useState(q);
  const [showModal, setShowModal] = useState(false);
  // Defaults are passed as undefined so they stay out of the URL entirely —
  // /campaigns rather than /campaigns?status=ALL&page=1.
  const { push, pending } = useListQuery({
    q,
    status: status === "ALL" ? undefined : status,
    page: page === 1 ? undefined : page,
  });

  // Filtering happens in the database now, so the box debounces into the URL
  // instead of slicing a local array.
  useEffect(() => {
    if (search === q) return;
    const t = setTimeout(() => push({ q: search || null, page: null }), 350);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  // Mirrors CreatorCore: the count under the title reflects the selected status
  // tab ("4 Active Campaigns", "497 Complete Campaigns"), not the overall total.
  // With a search active it reports the match count instead, so the number
  // always describes what is on screen.
  const activeTab = STATUS_TABS.find((t) => t.key === status);
  const tabCount = q ? filteredTotal : statusCounts[status] ?? 0;
  const countLabel =
    status === "ALL"
      ? `${tabCount} Campaign${tabCount !== 1 ? "s" : ""}`
      : `${tabCount} ${activeTab?.label ?? ""} Campaign${tabCount !== 1 ? "s" : ""}`;

  const filtered = campaigns;
  const totalPages = Math.max(1, Math.ceil(filteredTotal / CAMPAIGNS_PAGE_SIZE));

  return (
    <div className="cc-page-content rsp-page">
      {/* Header */}
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Campaigns
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            {countLabel}
          </p>
        </div>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Button variant="secondary" iconLeft={<FolderOpen size={15} />} size="sm">
            Folders
          </Button>
          <Link href="/campaigns/self-serve" style={{ textDecoration: "none" }}>
            <Button variant="secondary" iconLeft={<Sparkles size={15} />} size="sm">
              Self-serve campaign
            </Button>
          </Link>
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
      <StatusTabs
        ariaLabel="Filter by campaign status"
        style={{ marginBottom: 24 }}
        tabs={STATUS_TABS.map((tab) => ({
          ...tab,
          count: statusCounts[tab.key] ?? 0,
          badgeVariant: STATUS_BADGE_VARIANT[tab.key] ?? "neutral",
        }))}
        active={status}
        onChange={(key) => push({ status: key === "ALL" ? null : key, page: null })}
      />

      {/* Campaign List */}
      <Card variant="solid" noPadding>
        {filtered.length === 0 ? (
          <div style={{ padding: "48px 24px" }}>
            <EmptyState
              icon={<Target size={32} color="var(--cc-text-subtle)" />}
              title={q || status !== "ALL" ? "No campaigns match those filters" : "No campaigns yet"}
              description={
                q || status !== "ALL"
                  ? "Try a different search term or status."
                  : "Create your first campaign to get started"
              }
              action={
                q || status !== "ALL" ? (
                  <Button variant="secondary" onClick={() => { setSearch(""); push({ q: null, status: null, page: null }); }}>
                    Clear filters
                  </Button>
                ) : (
                  <Button variant="primary" iconLeft={<Plus size={15} />} onClick={() => setShowModal(true)}>
                    New Campaign
                  </Button>
                )
              }
            />
          </div>
        ) : (
          <div className="cc-stagger" style={CAMPAIGN_COLS}>
            <div className="cc-list-row cc-list-head">
              <span />
              <span>Campaign</span>
              <span className="cc-list-num cc-list-hide-sm">Budget</span>
              <span className="cc-list-num cc-list-hide-sm">Creators</span>
              <span className="cc-list-num cc-list-hide-sm">Posts</span>
              <span className="cc-list-num cc-list-hide-sm">Team</span>
              <span>Status</span>
            </div>

            {filtered.map((campaign, i) => (
              <Link key={campaign.id} href={`/campaigns/${campaign.id}`} style={{ textDecoration: "none" }}>
                <div
                  className="cc-table-row cc-list-row"
                  style={{ borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }}
                >
                  <Avatar name={campaign.title} size="md" />

                  <div style={{ minWidth: 0 }}>
                    <p title={campaign.title} style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {campaign.title}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--cc-text-subtle)" }}>
                      Last updated {timeAgo(campaign.updatedAt)}
                    </p>
                  </div>

                  <p className="cc-list-num cc-list-hide-sm" style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
                    {campaign.budget ? formatCurrency(campaign.budget) : "N/A"}
                  </p>

                  <p className="cc-list-num cc-list-hide-sm" style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
                    {campaign.creatorCount}
                  </p>

                  <p className="cc-list-num cc-list-hide-sm" style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
                    {campaign._count.posts}
                  </p>

                  <div className="cc-list-hide-sm" style={{ display: "flex", justifyContent: "center" }}>
                    <div className="cc-avatar-group">
                      <Avatar name="T" size="sm" />
                    </div>
                  </div>

                  <span style={{ justifySelf: "start" }}>
                    <Badge variant={STATUS_BADGE_VARIANT[campaign.status] ?? "neutral"} dot>
                      {campaign.status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}
                    </Badge>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      {filteredTotal > CAMPAIGNS_PAGE_SIZE && (
        <Pagination
          style={{ marginTop: 24 }}
          page={page}
          totalPages={totalPages}
          total={filteredTotal}
          pageSize={CAMPAIGNS_PAGE_SIZE}
          loading={pending}
          onPageChange={(p) => push({ page: p === 1 ? null : p })}
        />
      )}

      {showModal && <CampaignWizard clients={clients} onClose={() => setShowModal(false)} />}
    </div>
  );
}
