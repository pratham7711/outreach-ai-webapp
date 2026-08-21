"use client";

import React from "react";
import dynamic from "next/dynamic";
import { Activity, BarChart3, Download, Eye, TrendingUp } from "lucide-react";
import { Badge } from "@pratham7711/ui";
import { SectionCard } from "@/components/ds";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { platformColor } from "@/app/(dashboard)/analytics/shared";
import { stripAt } from "@/lib/format";
import { formatNumber, type PerformanceData } from "../types";

const PlatformBreakdownPie = dynamic(
  () => import("../DashboardCharts").then((m) => m.PlatformBreakdownPie),
  { ssr: false, loading: () => <Skeleton className="h-[200px] w-full rounded-lg" /> }
);

const ViewsByCampaignBar = dynamic(
  () => import("../DashboardCharts").then((m) => m.ViewsByCampaignBar),
  { ssr: false, loading: () => <Skeleton className="h-[200px] w-full rounded-lg" /> }
);

type PerformanceSectionProps = {
  financials: PerformanceData | null;
  loading: boolean;
  widgets: string[];
  onExportCreators: () => void;
};

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>;
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

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {widgets.includes("platform_breakdown") && (
          <SectionCard
            icon={Activity}
            title="Views by platform"
            description="Share of total views each platform contributed."
            metric="views"
          >
            {loading ? (
              <Skeleton className="h-[200px] w-full rounded-lg" />
            ) : platforms.length > 0 ? (
              <>
                <div className="h-[200px]">
                  <PlatformBreakdownPie
                    data={platforms}
                    colors={platforms.map((entry, i) => platformColor(entry.platform, i))}
                    formatNumber={formatNumber}
                  />
                </div>
                <ul className="mt-4 flex flex-col gap-2">
                  {platforms.map((p, i) => (
                    <li key={p.platform} className="flex items-center justify-between text-[13px]">
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ background: platformColor(p.platform, i) }}
                        />
                        <span className="font-semibold text-foreground">{p.platform}</span>
                      </span>
                      <span className="text-muted-foreground tabular-nums">
                        {formatNumber(p.views)} views · {p.postsCount} posts
                      </span>
                    </li>
                  ))}
                </ul>
              </>
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
              <Skeleton className="h-[200px] w-full rounded-lg" />
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

      {widgets.includes("top_posts") && (
        <SectionCard
          icon={Eye}
          title="Top posts"
          description="The individual posts pulling the most views."
          metric="views"
          padded={false}
        >
          {loading ? (
            <div className="px-6 py-5">
              <Skeleton className="h-40 w-full rounded-lg" />
            </div>
          ) : topPosts.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Creator</TableHead>
                    <TableHead>Campaign</TableHead>
                    <TableHead>Platform</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                    <TableHead className="text-right">Engagement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topPosts.map((post) => (
                    <TableRow key={post.id}>
                      <TableCell className="font-semibold text-foreground">
                        {post.creatorName ?? "Unknown"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {post.campaignTitle ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="neutral" size="sm">
                          {post.platform}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-foreground tabular-nums">
                        {formatNumber(post.viewsCount)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {post.engagementRate.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty>No posts yet</Empty>
          )}
        </SectionCard>
      )}

      {widgets.includes("creator_performance") && (
        <SectionCard
          icon={TrendingUp}
          title="Creator performance"
          description="What each creator was paid and what it returned."
          padded={false}
          action={
            <Button variant="outline" size="sm" onClick={onExportCreators}>
              <Download aria-hidden="true" className="size-3.5" />
              Export
            </Button>
          }
        >
          {loading ? (
            <div className="px-6 py-5">
              <Skeleton className="h-40 w-full rounded-lg" />
            </div>
          ) : creators.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Creator</TableHead>
                    <TableHead className="text-right">Activations</TableHead>
                    <TableHead className="text-right">Views</TableHead>
                    <TableHead className="text-right">Avg engagement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {creators.map((c) => (
                    <TableRow key={c.creatorId}>
                      <TableCell>
                        <div className="font-semibold text-foreground">{c.name}</div>
                        <div className="text-xs text-muted-foreground">@{stripAt(c.handle)}</div>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {c.activationCount}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {formatNumber(c.views)}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {c.avgEngagement}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <Empty>No creator performance data yet</Empty>
          )}
        </SectionCard>
      )}
    </div>
  );
}
