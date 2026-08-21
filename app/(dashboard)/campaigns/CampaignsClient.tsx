"use client";

import { useEffect, useState } from "react";
import { Plus, Search, FolderOpen, ChevronDown, Sparkles, Target } from "lucide-react";
import Link from "next/link";
import { Button, Card, Badge, Input, EmptyState, Avatar, Tooltip } from "@pratham7711/ui";
import { StatusTabs, Pagination, FilterDrawer, FilterButton } from "@/components/ds";
import type { FilterDef, FilterValues } from "@/components/ds";
import CampaignWizard from "@/components/modals/CampaignWizard";
import { formatCompactCurrency, timeAgo } from "@/lib/format";
import { useListQuery } from "@/lib/useListQuery";
import { CAMPAIGNS_PAGE_SIZE } from "@/lib/listPageSize";
import { imgSrc } from "@/lib/postMedia";

type Campaign = {
  id: string;
  title: string;
  status: string;
  currency: string;
  client?: { name: string } | null;
  thumbnailUrl?: string | null;
  _count: { activations: number; posts: number };
  creatorCount: number;
  updatedAt?: string;
};

type Client = { id: string; name: string };

const CAMPAIGN_TYPE_OPTIONS = [
  { value: "BUDGET_BASED", label: "Budget Based" },
  { value: "VIEW_BASED", label: "View Based" },
  { value: "OPEN_COMMUNITY", label: "Open Community" },
  { value: "PRIVATE_INVITE", label: "Private Invite" },
];

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
  "--cc-cols": "44px minmax(0, 1fr) 90px 80px 130px",
} as React.CSSProperties;


/**
 * 506 of 532 campaigns carry artwork that this list was throwing away in favour
 * of two initials. Falls back to the initials avatar only when there is genuinely
 * no image, so a missing thumbnail still reads as a campaign rather than a hole.
 */
function CampaignThumb({ title, src }: { title: string; src?: string | null }) {
  const url = imgSrc(src, 88); // 44px box, doubled for retina
  if (!url) return <Avatar name={title} size="md" />;
  return (
    <span
      style={{
        width: 44,
        height: 44,
        borderRadius: 8,
        overflow: "hidden",
        display: "block",
        border: "1px solid var(--cc-border)",
        background: "var(--cc-hover-bg)",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt=""
        loading="lazy"
        decoding="async"
        width={44}
        height={44}
        style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
      />
    </span>
  );
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
  filterValues,
  filterCount,
}: {
  campaigns: Campaign[];
  stats: { total: number; active: number; creatorCount: number };
  statusCounts: Record<string, number>;
  filteredTotal: number;
  page: number;
  q: string;
  status: string;
  clients: Client[];
  filterValues: FilterValues;
  filterCount: number;
}) {
  const [search, setSearch] = useState(q);
  const [showModal, setShowModal] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  // Defaults are passed as undefined so they stay out of the URL entirely —
  // /campaigns rather than /campaigns?status=ALL&page=1. The drawer's values
  // ride along so changing a tab or page keeps the filters applied.
  const { push, pending } = useListQuery({
    q,
    status: status === "ALL" ? undefined : status,
    page: page === 1 ? undefined : page,
    ...filterValues,
  });

  const FILTERS: FilterDef[] = [
    {
      type: "multiSelect",
      key: "clientIds",
      label: "Client",
      options: clients.map((c) => ({ value: c.id, label: c.name })),
    },
    { type: "multiSelect", key: "campaignType", label: "Campaign type", options: CAMPAIGN_TYPE_OPTIONS },
    { type: "dateRange", label: "Created", fromKey: "createdFrom", toKey: "createdTo" },
    {
      type: "toggleGroup",
      label: "Activity",
      options: [
        { key: "hasCreators", label: "Has creators assigned" },
        { key: "hasPosts", label: "Has posts delivered" },
      ],
    },
  ];

  const anyFilter = Boolean(q) || status !== "ALL" || filterCount > 0;
  const clearEverything = () => {
    setSearch("");
    const cleared: Record<string, null> = { q: null, status: null, page: null };
    for (const key of Object.keys(filterValues)) cleared[key] = null;
    push(cleared);
  };

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
          <Button variant="primary" iconLeft={<Plus size={15} />} size="sm" onClick={() => setShowModal(true)}>
            New Campaign
          </Button>
        </div>
      </div>

      {/* Search + filters */}
      <div style={{ marginBottom: 20, display: "flex", gap: 10, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Campaigns"
            iconLeft={<Search size={16} />}
          />
        </div>
        <FilterButton count={filterCount} onClick={() => setShowFilters(true)} />
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
              title={anyFilter ? "No campaigns match those filters" : "No campaigns yet"}
              description={
                anyFilter
                  ? "Try a different search term, status or filter."
                  : "Create your first campaign to get started"
              }
              action={
                anyFilter ? (
                  <Button variant="secondary" onClick={clearEverything}>
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
              <span className="cc-list-num cc-list-hide-sm">Creators</span>
              <span className="cc-list-num cc-list-hide-sm">Posts</span>
              <span>Status</span>
            </div>

            {filtered.map((campaign, i) => (
              <Link prefetch={false} key={campaign.id} href={`/campaigns/${campaign.id}`} style={{ textDecoration: "none" }}>
                <div
                  className="cc-table-row cc-list-row"
                  style={{ borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined }}
                >
                  <CampaignThumb title={campaign.title} src={campaign.thumbnailUrl} />

                  <div style={{ minWidth: 0 }}>
                    <p title={campaign.title} style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", marginBottom: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {campaign.title}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--cc-text-subtle)" }}>
                      Last updated {timeAgo(campaign.updatedAt)}
                    </p>
                  </div>

                  <p className="cc-list-num cc-list-hide-sm" style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
                    {campaign.creatorCount}
                  </p>

                  <p className="cc-list-num cc-list-hide-sm" style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>
                    {campaign._count.posts}
                  </p>

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

      <FilterDrawer
        open={showFilters}
        onClose={() => setShowFilters(false)}
        filters={FILTERS}
        values={filterValues}
        onApply={(next) => push({ ...next, page: null })}
      />

      {showModal && <CampaignWizard clients={clients} onClose={() => setShowModal(false)} />}
    </div>
  );
}
