"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Layers, Megaphone, Music } from "lucide-react";
import { PostAnalysisTable, type AnalysisPost } from "@/components/posts/PostAnalysisTable";
import { PostingTimeHeatmap } from "@/app/(dashboard)/analytics/PostingTimeHeatmap";
import { formatCompact, platformLabel } from "@/lib/format";
import { platformColor } from "@/app/(dashboard)/analytics/shared";
import AttachCampaigns, { type AttachableCampaign } from "./AttachCampaigns";

type Summary = {
  campaignCount: number;
  activeCampaignCount: number;
  phaseCount: number;
  postCount: number;
  totalViews: number;
  totalLikes: number;
  totalComments: number;
  totalShares: number;
  engagementRate: number;
  totalBudget: number;
};

type CampaignRow = {
  id: string;
  title: string;
  status: string;
  budget: number | null;
  phaseCount: number;
  postCount: number;
  views: number;
};

type PhaseRow = {
  id: string;
  name: string;
  sequence: number;
  campaignId: string;
  campaignTitle: string;
  targetPosts: number | null;
  postCount: number;
  views: number;
};

export type SongDashboardData = {
  song: { id: string; title: string; artist: string; coverUrl: string | null; releaseDate: string | null };
  summary: Summary;
  campaigns: CampaignRow[];
  phases: PhaseRow[];
  platformBreakdown: { platform: string; views: number; posts: number }[];
  posts: AnalysisPost[];
};

const card: React.CSSProperties = {
  background: "var(--cc-card)",
  border: "1px solid var(--cc-border)",
  borderRadius: 12,
  padding: 20,
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
  count: number;
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
      <span style={{ fontSize: 13, color: "var(--cc-text-muted)", width: 96, flexShrink: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
      </span>
      <span style={{ flex: 1, height: 8, background: "var(--cc-bg)", borderRadius: 4, overflow: "hidden" }}>
        <span
          style={{
            display: "block", height: "100%", borderRadius: 4, background: color,
            width: `${max > 0 ? (count / max) * 100 : 0}%`, transition: "width 400ms ease-out",
          }}
        />
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", fontVariantNumeric: "tabular-nums", flexShrink: 0 }}>
        {formatCompact(count)}{suffix}
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
    () => platformBreakdown.reduce((m, p) => Math.max(m, p.views), 0),
    [platformBreakdown],
  );
  const phaseMax = useMemo(() => phases.reduce((m, p) => Math.max(m, p.views), 0), [phases]);

  const phaseOptions = useMemo(
    () => phases.map((p) => ({ id: p.id, name: p.name, campaignTitle: p.campaignTitle })),
    [phases],
  );

  return (
    <div className="rsp-page">
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <div
          aria-hidden="true"
          style={{
            width: 64, height: 64, borderRadius: 12, flexShrink: 0,
            background: song.coverUrl ? `url(${song.coverUrl}) center/cover` : "var(--cc-bg)",
            border: "1px solid var(--cc-border)",
            display: "flex", alignItems: "center", justifyContent: "center",
          }}
        >
          {!song.coverUrl && <Music size={26} color="var(--cc-text-subtle)" />}
        </div>
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.02em", marginBottom: 2 }}>
            {song.title}
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>{song.artist}</p>
        </div>
      </div>

      {/* Hero: the two numbers you actually open this page for, and the whole
          card walks through to the posts that produced them. */}
      <Link
        href="#posts"
        style={{
          ...card,
          display: "flex", alignItems: "center", gap: 32, flexWrap: "wrap",
          marginBottom: 20, textDecoration: "none",
          background: "linear-gradient(135deg, color-mix(in srgb, var(--cc-primary) 8%, transparent) 0%, var(--cc-card) 100%)",
        }}
      >
        <HeroStat value={formatCompact(summary.totalViews)} label="Total views" sub={`across ${summary.postCount} posts`} />
        <span aria-hidden="true" style={{ width: 1, height: 48, background: "var(--cc-border)" }} />
        <HeroStat
          value={String(summary.campaignCount)}
          label="Campaigns"
          sub={`${summary.activeCampaignCount} active · ${summary.phaseCount} phases`}
        />
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, color: "var(--cc-primary)" }}>
          View posts <ArrowRight size={14} aria-hidden="true" />
        </span>
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-2" style={{ gap: 20, marginBottom: 20 }}>
        <div style={card}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", marginBottom: 16 }}>Views by platform</h2>
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
        </div>

        <div style={card}>
          <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", marginBottom: 16 }}>Views by phase</h2>
          {phases.length === 0 ? (
            <Empty>This song&rsquo;s campaigns don&rsquo;t use phases yet.</Empty>
          ) : (
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
          )}
        </div>
      </div>

      <div style={{ ...card, marginBottom: 20 }}>
        <h2 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", marginBottom: 16 }}>Campaigns</h2>
        <div style={{ marginBottom: 16 }}>
          <AttachCampaigns songId={song.id} campaigns={attachable} />
        </div>
        {campaigns.length === 0 ? (
          <Empty>No campaigns attached to this song yet.</Empty>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {campaigns.map((c) => (
              <Link
                key={c.id}
                href={`/campaigns/${c.id}`}
                className="cc-table-row"
                style={{
                  display: "flex", alignItems: "center", gap: 12, padding: "10px 8px",
                  margin: "0 -8px", borderRadius: 8, textDecoration: "none",
                }}
              >
                <Megaphone size={15} color="var(--cc-text-muted)" aria-hidden="true" />
                <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{c.title}</span>
                <span style={{ fontSize: 12, color: "var(--cc-text-muted)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Layers size={12} aria-hidden="true" /> {c.phaseCount}
                </span>
                <span style={{ fontSize: 13, color: "var(--cc-text-muted)", fontVariantNumeric: "tabular-nums" }}>
                  {c.postCount} posts
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", fontVariantNumeric: "tabular-nums", minWidth: 64, textAlign: "right" }}>
                  {formatCompact(c.views)}
                </span>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div id="posts" style={card}>
        <div style={{ display: "flex", gap: 4, marginBottom: 20 }}>
          <TabButton active={tab === "posts"} onClick={() => setTab("posts")}>All posts</TabButton>
          <TabButton active={tab === "timing"} onClick={() => setTab("timing")}>When to post</TabButton>
        </div>
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
    </div>
  );
}

function HeroStat({ value, label, sub }: { value: string; label: string; sub: string }) {
  return (
    <div>
      <p style={{ fontSize: 36, fontWeight: 700, color: "var(--cc-text)", lineHeight: 1, fontVariantNumeric: "tabular-nums", marginBottom: 6 }}>
        {value}
      </p>
      <p style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{label}</p>
      <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{sub}</p>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: active ? "var(--cc-primary)" : "transparent",
        color: active ? "white" : "var(--cc-text-muted)",
        border: active ? "none" : "1px solid var(--cc-border)",
        borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "var(--cc-text-muted)" }}>{children}</p>;
}
