"use client";

import React from "react";
import dynamic from "next/dynamic";
import { Activity, BarChart3, Download, Eye, TrendingUp } from "lucide-react";
import {
  Button,
  DataTable,
  PlatformTag,
  SectionCard,
  Skeleton,
  type DataTableColumn,
} from "@/components/ds";
import { PlatformSplit } from "@/components/charts/PlatformSplit";
import { UNKNOWN, stripAt } from "@/lib/format";
import { loadCharts } from "@/components/charts/lazyCharts";
import { formatNumber, type PerformanceData } from "../types";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import { creatorNameParts } from "@/lib/creators/creatorName";

const ViewsByCampaignBar = dynamic(
  () => loadCharts().then((m) => m.ViewsByCampaignBar),
  { ssr: false, loading: () => <Skeleton height={200} /> }
);

type TopPost = PerformanceData["topPosts"][number];
type CreatorRow = PerformanceData["creatorPerformance"][number];

/* Both tables sit in a SectionCard that runs to its edges, so they are bare
   DataTables: one header style, numbers right-aligned and tabular. */
const TOP_POST_COLUMNS: DataTableColumn<TopPost>[] = [
  {
    key: "creator",
    header: "Creator",
    minWidth: 200,
    render: (post) => {
      const { name, handle } = creatorNameParts(post.creatorName, post.creatorHandle);
      return (
        <span className="flex items-center gap-2.5">
          <CreatorAvatar id={post.creatorId} name={post.creatorName ?? "Unknown"} size="sm" />
          <span className="min-w-0">
            <span className="cc-dt-truncate font-medium" title={name}>{name}</span>
            {handle ? <span className="cc-dt-sub">{handle}</span> : null}
          </span>
        </span>
      );
    },
  },
  {
    key: "campaign",
    header: "Campaign",
    minWidth: 160,
    truncate: (post) => post.campaignTitle ?? undefined,
    render: (post) => post.campaignTitle ?? "—",
  },
  { key: "platform", header: "Platform", width: 136, render: (post) => <PlatformTag platform={post.platform} /> },
  { key: "views", header: "Views", width: 120, align: "right", render: (post) => formatNumber(post.viewsCount) },
  {
    key: "engagement",
    header: "Engagement",
    width: 128,
    align: "right",
    /* Two decimals, as the post's rate reads on the Posts tab, the post page
       and the exports. */
    render: (post) => (post.engagementRate === null ? UNKNOWN : `${post.engagementRate.toFixed(2)}%`),
  },
];

const CREATOR_COLUMNS: DataTableColumn<CreatorRow>[] = [
  {
    key: "creator",
    header: "Creator",
    minWidth: 220,
    render: (c) => (
      <span className="flex items-center gap-2.5">
        <CreatorAvatar id={c.creatorId} name={c.name} size="sm" />
        <span className="min-w-0">
          <span className="cc-dt-truncate font-medium" title={c.name}>{c.name}</span>
          {/* Same handle, different platform, different person's account --
              and two rows here that look identical without it. */}
          <span className="cc-dt-sub flex items-center gap-1.5">
            <span>@{stripAt(c.handle)}</span>
            {c.platform ? <PlatformTag platform={c.platform} /> : null}
          </span>
        </span>
      </span>
    ),
  },
  { key: "activations", header: "Activations", width: 128, align: "right", render: (c) => formatNumber(c.activationCount) },
  {
    key: "views",
    header: "Views",
    width: 128,
    align: "right",
    /* "—" with the reason, never 0: none of their posts in range has a view
       count we read. */
    render: (c) =>
      c.views === null ? (
        <span title="No view count read for any of their posts in this range">{UNKNOWN}</span>
      ) : (
        formatNumber(c.views)
      ),
  },
  {
    key: "engagement",
    header: "Avg engagement",
    width: 148,
    align: "right",
    render: (c) => (c.avgEngagement === null ? UNKNOWN : `${c.avgEngagement}%`),
  },
];

type PerformanceSectionProps = {
  financials: PerformanceData | null;
  loading: boolean;
  widgets: string[];
  onExportCreators: () => void;
};

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-sm text-[var(--cc-text-muted)]">{children}</p>;
}

export function PerformanceSection({
  financials,
  loading,
  widgets,
  onExportCreators,
}: PerformanceSectionProps) {
  const platforms = financials?.platformBreakdown ?? [];
  const byCampaign = financials?.viewsByCampaign ?? [];
  const topPosts = financials?.topPosts ?? [];
  const creators = financials?.creatorPerformance ?? [];
  /* Two columns only when both charts are on: a lone chart in a two-column row
     filled half of it and left the other half blank. */
  const chartCount = ["platform_breakdown", "campaign_reach"].filter((w) => widgets.includes(w)).length;

  return (
    <div className="flex flex-col gap-6">
      {chartCount > 0 && (
        <div className={chartCount === 2 ? "grid grid-cols-1 gap-6 lg:grid-cols-2" : "grid grid-cols-1 gap-6"}>
          {widgets.includes("platform_breakdown") && (
            <SectionCard
              icon={Activity}
              title="Views by platform"
              description="Share of total views each platform contributed."
              metric="views"
            >
              {loading ? (
                <Skeleton height={160} />
              ) : platforms.length > 0 ? (
                /* One labelled bar per platform, the same component as every
                   other "views by platform". A platform whose posts in range
                   carry no view count (Instagram photos publish none) sums to
                   0 -- which is "not known", not "no views", so it reads "—". */
                <PlatformSplit
                  rows={platforms.map((p) => ({
                    platform: p.platform,
                    views: p.views > 0 ? p.views : null,
                    posts: p.postsCount,
                  }))}
                />
              ) : (
                <Empty>No platform data yet</Empty>
              )}
            </SectionCard>
          )}

          {widgets.includes("campaign_reach") && (
            <SectionCard
              icon={BarChart3}
              title="Views by campaign"
              description={`Top ${Math.min(5, byCampaign.length) || 5} campaigns by views delivered.`}
              metric="totalViews"
            >
              {loading ? (
                <Skeleton height={200} />
              ) : byCampaign.length > 0 ? (
                <div className="h-[200px]">
                  <ViewsByCampaignBar
                    data={byCampaign.slice(0, 5)}
                    formatNumber={formatNumber}
                  />
                </div>
              ) : (
                <Empty>No campaign views yet</Empty>
              )}
            </SectionCard>
          )}

        </div>
      )}

      {widgets.includes("top_posts") && (
        <SectionCard
          icon={Eye}
          title="Top posts"
          description="The individual posts pulling the most views."
          metric="views"
          padded={false}
        >
          <DataTable
            bare
            caption="Top posts"
            columns={TOP_POST_COLUMNS}
            rows={loading ? [] : topPosts}
            rowKey={(post) => post.id}
            loading={loading}
            skeletonRows={5}
            empty={
              /* The list only ranks posts with a view count, so posts can
                 exist in the range while it is empty. */
              <Empty>
                {platforms.some((p) => p.postsCount > 0)
                  ? "No post in this range has a view count yet"
                  : "No posts yet"}
              </Empty>
            }
          />
        </SectionCard>
      )}

      {widgets.includes("creator_performance") && (
        <SectionCard
          icon={TrendingUp}
          title="Creator performance"
          /* Promised money and delivered none: the columns are Creator,
             Activations, Views and Avg engagement -- there is no payment figure
             in this table, and the financials rollup this reads does not fetch
             one. */
          description="Your ten highest-reaching creators, with how many campaigns each is booked on and how hard their posts worked."
          padded={false}
          action={
            <Button variant="secondary" size="sm" iconLeft={<Download size={14} aria-hidden="true" />} onClick={onExportCreators}>
              Export
            </Button>
          }
        >
          <DataTable
            bare
            caption="Creator performance"
            columns={CREATOR_COLUMNS}
            rows={loading ? [] : creators}
            rowKey={(c) => c.creatorId}
            loading={loading}
            skeletonRows={5}
            empty={<Empty>No creator performance data yet</Empty>}
          />
        </SectionCard>
      )}
    </div>
  );
}
