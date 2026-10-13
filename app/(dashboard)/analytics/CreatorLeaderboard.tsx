"use client";
import React from "react";
import Link from "next/link";
import { Card, EmptyState } from "@pratham7711/ui";
import { User } from "lucide-react";
import { formatNumber, formatPercent } from "./shared";
import { stripAt, UNKNOWN } from "@/lib/format";
import CreatorAvatar from "@/components/creators/CreatorAvatar";

export type LeaderboardCreator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  avatarUrl: string | null;
  followersCount: number;
  campaigns: number;
  /** Null when none of their posts in range has a view count. */
  views: number | null;
  likes: number;
  posts: number;
  earnings: number;
  /** Null when none of their posts had views and likes read. */
  engagements: number | null;
  engagementRate: number | null;
};

export default function CreatorLeaderboard({ creators }: { creators: LeaderboardCreator[] }) {
  return (
    <Card variant="solid" noPadding>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--cc-border)" }}>
        <span className="cc-panel-title">Creator Leaderboard</span>
      </div>
      {creators.length === 0 ? (
        <div style={{ padding: 24 }}>
          <EmptyState icon={<User size={32} color="var(--cc-text-subtle)" />} title="No post data yet" description="Sync posts to see creator rankings." />
        </div>
      ) : (
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <div style={{ minWidth: 460 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "28px 1fr 64px 84px 72px",
              gap: 12,
              padding: "10px 24px",
              borderBottom: "1px solid var(--cc-border)",
            }}
          >
            {["", "Creator", "Camps", "Views", "Eng."].map((h, i) => (
              <span
                key={i}
                className="cc-microlabel" style={{ textAlign: i >= 2 ? "right" : "left" }}
              >
                {h}
              </span>
            ))}
          </div>
          {creators.map((creator, i) => (
            <Link prefetch={false}
              key={creator.id}
              href={`/creators/${creator.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "28px 1fr 64px 84px 72px",
                gap: 12,
                padding: "12px 24px",
                alignItems: "center",
                borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span style={{ fontSize: "var(--cc-t-12)", fontWeight: 700, color: i < 3 ? "var(--cc-primary)" : "var(--cc-text-subtle)", textAlign: "center" }}>
                {i + 1}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <CreatorAvatar id={creator.id} name={creator.name} size="sm" />
                <div style={{ minWidth: 0 }}>
                  <p title={creator.name} style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{creator.name}</p>
                  <p title={`@${stripAt(creator.handle)}`} style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{stripAt(creator.handle)}</p>
                </div>
              </div>
              <span style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", textAlign: "right" }}>{creator.campaigns}</span>
              {/* "—" with the reason, never 0: these creators' posts carry no
                  view count we read (Instagram photos publish none), and the
                  route ranks them last. */}
              <span
                title={creator.views === null ? `No view count read for any of their ${creator.posts} post${creator.posts === 1 ? "" : "s"} in this range` : undefined}
                style={{ fontSize: "var(--cc-t-13)", fontWeight: 700, color: creator.views === null ? "var(--cc-text-muted)" : "var(--cc-text)", textAlign: "right" }}
              >
                {creator.views === null ? UNKNOWN : formatNumber(creator.views)}
              </span>
              <span
                title={creator.engagementRate === null ? "No post of theirs in this range had both views and likes read" : undefined}
                style={{ fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: creator.engagementRate === null ? "var(--cc-text-muted)" : "var(--cc-text)", textAlign: "right" }}
              >
                {creator.engagementRate === null ? UNKNOWN : formatPercent(creator.engagementRate)}
              </span>
            </Link>
          ))}
          </div>
        </div>
      )}
    </Card>
  );
}
