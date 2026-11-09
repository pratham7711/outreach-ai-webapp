"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Eye, Layers, Megaphone, Music } from "lucide-react";
import { PostAnalysisTable, type AnalysisPost } from "@/components/posts/PostAnalysisTable";
import { PostingTimeHeatmap } from "@/app/(dashboard)/analytics/PostingTimeHeatmap";
import { platformLabel, formatFull } from "@/lib/format";
import { asOfCaption } from "@/lib/dataAge";
import { imgSrc } from "@/lib/postMedia";
import { platformColor } from "@/app/(dashboard)/analytics/shared";
import AttachCampaigns, { DetachCampaign, type AttachableCampaign } from "./AttachCampaigns";
import { noun } from "@/lib/ui/noun";
import { MetricTile, PageHeader, SectionCard, StatusTabs } from "@/components/ds";

type Summary = {
  campaignCount: number;
  activeCampaignCount: number;
  phaseCount: number;
  postCount: number;
  /** Each video once; null when no post has a view count we hold. */
  totalViews: number | null;
  /** Videos whose views are known, of `videoCount`. Optional: the API's older shape lacks them. */
  viewsKnown?: number;
  videoCount?: number;
  /** The newest reading behind totalViews. */
  viewsAsOf?: string | null;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  /** A fraction; null when no post has both views and likes read. */
  engagementRate: number | null;
  totalBudget: number;
};

type CampaignRow = {
  id: string;
  title: string;
  status: string;
  budget: number | null;
  phaseCount: number;
  postCount: number;
  views: number | null;
};

type PhaseRow = {
  id: string;
  name: string;
  sequence: number;
  campaignId: string;
  campaignTitle: string;
  targetPosts: number | null;
  postCount: number;
  views: number | null;
};

export type SongDashboardData = {
  song: { id: string; title: string; artist: string; coverUrl: string | null; releaseDate: string | null };
  summary: Summary;
  campaigns: CampaignRow[];
  phases: PhaseRow[];
  platformBreakdown: { platform: string; views: number | null; posts: number }[];
  posts: AnalysisPost[];
};

/** Label · bar · count, the row shape that reads better than a pie once you have
 *  more than three slices — and unlike a pie slice, each row is a link. */
function DistributionRow({
  label,
  count,
  max,
  color,
  href,
  suffix,
}: {
  label: string;
  /** Null when none of the row's posts has a view count read: "—", not 0. */
  count: number | null;
  max: number;
  color: string;
  href: string;
  suffix?: string;
}) {
  return (
    <Link
      href={href}
      className="cc-table-row"
      style={{
        display: "flex", alignItems: "center", gap: 12,
        padding: "6px 8px", margin: "0 -8px", borderRadius: 6, textDecoration: "none",
      }}
    >
      <span style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", width: 96, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ flex: 1, height: 8, background: "var(--cc-bg)", borderRadius: 4, overflow: "hidden" }}>
        <span
          style={{
            display: "block", height: "100%", borderRadius: 4, background: color,
            width: `${max > 0 && count !== null ? (count / max) * 100 : 0}%`, transition: "width 400ms ease-out",
          }}
        />
      </span>
      <span
        title={count === null ? "None of these posts has a view count read yet" : undefined}
        style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}
      >
        {count === null ? "—" : formatFull(count)}{count === null ? null : suffix}
      </span>
    </Link>
  );
}

export default function SongDashboard({
  data,
  attachable = [],
}: {
  data: SongDashboardData;
  attachable?: AttachableCampaign[];
}) {
  const { song, summary, campaigns, phases, platformBreakdown, posts } = data;
  const [tab, setTab] = useState<"posts" | "timing">("posts");

  const platformMax = useMemo(
    () => platformBreakdown.reduce((m, p) => Math.max(m, p.views ?? 0), 0),
    [platformBreakdown],
  );
  const phaseMax = useMemo(() => phases.reduce((m, p) => Math.max(m, p.views ?? 0), 0), [phases]);
  const viewsNote = asOfCaption(summary.viewsAsOf, {
    known: summary.viewsKnown,
    total: summary.videoCount ?? summary.postCount,
    noun: "video",
    what: "views",
  });
  const cover = imgSrc(song.coverUrl, 128);

  const phaseOptions = useMemo(
    () => phases.map((p) => ({ id: p.id, name: p.name, campaignTitle: p.campaignTitle })),
    [phases],
  );

  return (
    <div className="rsp-page">
      <PageHeader
        title={song.title}
        back={{ href: "/songs", label: "Songs" }}
        leading={
          <span
            className="cc-page-thumb cc-song-thumb"
            aria-hidden="true"
            style={cover ? { backgroundImage: `url("${cover}")` } : undefined}
          >
            {cover ? null : <Music size={18} />}
          </span>
        }
        subtitle={song.artist}
      />

      {/* The two numbers you open this page for. */}
      <div className="cc-tiles-balanced cc-song-tiles">
        <MetricTile
          icon={Eye}
          label="Total views"
          value={
            <span
              title={summary.totalViews === null && summary.postCount > 0 ? "None of this song's posts has a view count read yet" : undefined}
            >
              {summary.totalViews === null ? "—" : formatFull(summary.totalViews)}
            </span>
          }
          footer={
            <>
              across {summary.postCount} {noun(summary.postCount, "post")}
              {viewsNote ? <span data-views-asof className="cc-song-tile-note">{viewsNote}</span> : null}
            </>
          }
        />
        <MetricTile
          icon={Megaphone}
          label="Campaigns"
          value={String(summary.campaignCount)}
          footer={summary.phaseCount > 0 ? `${summary.activeCampaignCount} active · ${summary.phaseCount} phases` : `${summary.activeCampaignCount} active`}
        />
      </div>

      {/* Nothing in the app writes phases yet, so the phase card shows only when
          one exists; until then the platform card has the row to itself. */}
      <div className={`cc-song-grid${phases.length > 0 ? " cc-song-grid-2" : ""}`}>
        <SectionCard title="Views by platform">
          {platformBreakdown.length === 0 ? (
            <Empty>No posts yet.</Empty>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {platformBreakdown.map((p, i) => (
                <DistributionRow
                  key={p.platform}
                  label={platformLabel(p.platform)}
                  count={p.views}
                  max={platformMax}
                  color={platformColor(p.platform, i)}
                  href="#posts"
                />
              ))}
            </div>
          )}
        </SectionCard>

        {phases.length > 0 && (
          <SectionCard title="Views by phase">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {phases.map((p, i) => (
                <DistributionRow
                  key={p.id}
                  label={p.name}
                  count={p.views}
                  max={phaseMax}
                  color={platformColor(String(i), i)}
                  href={`/campaigns/${p.campaignId}`}
                />
              ))}
            </div>
          </SectionCard>
        )}
      </div>

      <SectionCard title="Campaigns" className="cc-song-section">
        <div style={{ marginBottom: 16 }}>
          <AttachCampaigns songId={song.id} campaigns={attachable} />
        </div>
        {campaigns.length === 0 ? (
          <Empty>No campaigns attached to this song yet.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {campaigns.map((c) => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <Link
                href={`/campaigns/${c.id}`}
                className="cc-table-row"
                style={{
                  flex: 1, minWidth: 0,
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 8px",
                  margin: "0 0 0 -8px", borderRadius: 8, textDecoration: "none",
                }}
              >
                <Megaphone size={15} color="var(--cc-text-muted)" aria-hidden="true" />
                <span style={{ flex: 1, fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{c.title}</span>
                {c.phaseCount > 0 && (
                  <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Layers size={12} aria-hidden="true" /> {c.phaseCount}
                  </span>
                )}
                <span className="cc-phone-hide" style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                  {c.postCount} {noun(c.postCount, "post")}
                </span>
                <span
                  title={c.views === null ? (c.postCount === 0 ? "No posts yet" : "None of this campaign's posts has a view count read yet") : undefined}
                  style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", fontVariantNumeric: "tabular-nums", minWidth: 64, textAlign: "right" }}
                >
                  {c.views === null ? "—" : formatFull(c.views)}
                </span>
              </Link>
              <DetachCampaign campaignId={c.id} title={c.title} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard id="posts" title="Posts">
        <StatusTabs
          ariaLabel="Posts view"
          idBase="song-posts"
          tabs={[
            { key: "posts", label: "All posts" },
            { key: "timing", label: "When to post" },
          ]}
          active={tab}
          onChange={(key) => setTab(key as typeof tab)}
          style={{ marginBottom: 20 }}
        />
        <div role="tabpanel" id="song-posts-panel" aria-labelledby={`song-posts-tab-${tab}`}>
        {tab === "posts" ? (
          <PostAnalysisTable
            posts={posts}
            phases={phaseOptions}
            emptyMessage="No posts for this song yet."
          />
        ) : (
          <PostingTimeHeatmap
            posts={posts.map((p) => ({
              postedAt: p.postedAt,
              platform: p.platform,
              viewsCount: p.viewsCount,
            }))}
            platform="ALL"
          />
        )}
        </div>
      </SectionCard>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ padding: "24px 0", textAlign: "center", fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>{children}</p>;
}
