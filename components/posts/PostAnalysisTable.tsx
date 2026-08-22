"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Badge } from "@pratham7711/ui";
import { Dropdown, SortableTh, numericCell, type SortAccessors, useTableSort } from "@/components/ds";
import { formatCompact, formatDateTimeAbs, platformLabel, stripAt, timeAgo } from "@/lib/format";
import { PLATFORM_FILTER_OPTIONS } from "@/lib/platforms/constants";

export type AnalysisPost = {
  id: string;
  campaignId: string;
  campaignTitle: string | null;
  phaseId: string | null;
  platform: string;
  postUrl: string;
  postedAt: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  engagementRate: number;
  status: string;
  lastSyncedAt: string | null;
  creatorName: string | null;
  creatorHandle: string | null;
};

type PhaseOption = { id: string; name: string; campaignTitle: string };

// Module scope so useTableSort's memo is not defeated by a fresh object each render.
const SORT: SortAccessors<AnalysisPost> = {
  creator: (p) => p.creatorName,
  campaign: (p) => p.campaignTitle,
  platform: (p) => platformLabel(p.platform),
  postedAt: (p) => new Date(p.postedAt).getTime(),
  views: (p) => p.viewsCount,
  likes: (p) => p.likesCount,
  comments: (p) => p.commentsCount,
  shares: (p) => p.sharesCount,
  engagement: (p) => p.engagementRate,
};

const selectStyle: React.CSSProperties = {
  background: "var(--cc-card)",
  border: "1px solid var(--cc-border)",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 13,
  color: "var(--cc-text)",
};

export function PostAnalysisTable({
  posts,
  phases = [],
  emptyMessage = "No posts match these filters.",
}: {
  posts: AnalysisPost[];
  phases?: PhaseOption[];
  emptyMessage?: string;
}) {
  const [platform, setPlatform] = useState("ALL");
  const [campaign, setCampaign] = useState("ALL");
  const [phase, setPhase] = useState("ALL");
  const [search, setSearch] = useState("");

  const campaigns = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of posts) if (p.campaignTitle) seen.set(p.campaignId, p.campaignTitle);
    return [...seen.entries()].map(([id, title]) => ({ id, title }));
  }, [posts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return posts.filter((p) => {
      if (platform !== "ALL" && p.platform !== platform) return false;
      if (campaign !== "ALL" && p.campaignId !== campaign) return false;
      if (phase !== "ALL" && p.phaseId !== phase) return false;
      if (!q) return true;
      return (
        (p.creatorName ?? "").toLowerCase().includes(q) ||
        (p.creatorHandle ?? "").toLowerCase().includes(q) ||
        (p.campaignTitle ?? "").toLowerCase().includes(q)
      );
    });
  }, [posts, platform, campaign, phase, search]);

  const { sorted, sort, toggle } = useTableSort(filtered, SORT, { key: "views", dir: "desc" });

  const totals = useMemo(
    () => ({
      views: filtered.reduce((s, p) => s + p.viewsCount, 0),
      posts: filtered.length,
    }),
    [filtered],
  );

  return (
    <div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 16 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search creator or campaign…"
          aria-label="Search posts"
          style={{ ...selectStyle, flex: 1, minWidth: 200 }}
        />
        <Dropdown
          ariaLabel="Platform"
          align="left"
          minWidth={150}
          value={platform}
          onChange={setPlatform}
          options={PLATFORM_FILTER_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
        />
        {campaigns.length > 1 && (
          <Dropdown
            ariaLabel="Campaign"
            align="left"
            minWidth={170}
            value={campaign}
            onChange={setCampaign}
            options={[
              { value: "ALL", label: "All campaigns" },
              ...campaigns.map((c) => ({ value: c.id, label: c.title })),
            ]}
          />
        )}
        {phases.length > 0 && (
          <Dropdown
            ariaLabel="Phase"
            align="left"
            minWidth={190}
            value={phase}
            onChange={setPhase}
            options={[
              { value: "ALL", label: "All phases" },
              ...phases.map((ph) => ({ value: ph.id, label: `${ph.name} · ${ph.campaignTitle}` })),
            ]}
          />
        )}
        <span style={{ fontSize: 13, color: "var(--cc-text-muted)", fontVariantNumeric: "tabular-nums" }}>
          {totals.posts} posts · {formatCompact(totals.views)} views
        </span>
      </div>

      {sorted.length === 0 ? (
        <p style={{ padding: "40px 0", textAlign: "center", fontSize: 14, color: "var(--cc-text-muted)" }}>
          {emptyMessage}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "var(--cc-hover-bg)" }}>
                <SortableTh label="Creator" sortKey="creator" sort={sort} onToggle={toggle} />
                <SortableTh label="Campaign" sortKey="campaign" sort={sort} onToggle={toggle} />
                <SortableTh label="Platform" sortKey="platform" sort={sort} onToggle={toggle} />
                <SortableTh label="Posted" sortKey="postedAt" sort={sort} onToggle={toggle} />
                <SortableTh label="Views" sortKey="views" sort={sort} onToggle={toggle} align="right" />
                <SortableTh label="Likes" sortKey="likes" sort={sort} onToggle={toggle} align="right" />
                <SortableTh label="Comments" sortKey="comments" sort={sort} onToggle={toggle} align="right" />
                <SortableTh label="Eng." sortKey="engagement" sort={sort} onToggle={toggle} align="right" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} className="cc-table-row" style={{ borderTop: "1px solid var(--cc-border)" }}>
                  <td style={{ padding: "12px 24px" }}>
                    <Link
                      href={`/campaigns/${p.campaignId}/posts/${p.id}`}
                      style={{ textDecoration: "none", color: "var(--cc-text)", fontWeight: 600, fontSize: 14 }}
                    >
                      {p.creatorName ?? "Unknown"}
                    </Link>
                    {p.creatorHandle && (
                      <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{stripAt(p.creatorHandle)}</div>
                    )}
                  </td>
                  <td style={{ padding: "12px 24px", fontSize: 13, color: "var(--cc-text-muted)" }}>
                    {p.campaignTitle ?? "—"}
                  </td>
                  <td style={{ padding: "12px 24px" }}>
                    <Badge variant="neutral" size="sm">{platformLabel(p.platform)}</Badge>
                  </td>
                  <td style={{ padding: "12px 24px", fontSize: 13, color: "var(--cc-text)" }}>
                    {formatDateTimeAbs(p.postedAt)}
                    <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>
                      synced {p.lastSyncedAt ? timeAgo(p.lastSyncedAt) : "never"}
                    </div>
                  </td>
                  <td style={numericCell}>{formatCompact(p.viewsCount)}</td>
                  <td style={numericCell}>{formatCompact(p.likesCount)}</td>
                  <td style={numericCell}>{formatCompact(p.commentsCount)}</td>
                  <td style={numericCell}>{p.engagementRate.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
