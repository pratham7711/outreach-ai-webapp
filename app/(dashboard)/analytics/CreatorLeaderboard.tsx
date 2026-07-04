"use client";
import React from "react";
import Link from "next/link";
import { Card, Avatar, EmptyState } from "@pratham7711/ui";
import { formatNumber, formatCurrency, formatPercent } from "./shared";

export type LeaderboardCreator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  avatarUrl: string | null;
  followersCount: number;
  campaigns: number;
  views: number;
  likes: number;
  posts: number;
  earnings: number;
  engagements: number;
  engagementRate: number;
  emv: number;
};

export default function CreatorLeaderboard({ creators }: { creators: LeaderboardCreator[] }) {
  return (
    <Card variant="solid" noPadding>
      <div style={{ padding: "16px 24px", borderBottom: "1px solid var(--cc-border)" }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>Creator Leaderboard</span>
      </div>
      {creators.length === 0 ? (
        <div style={{ padding: 24 }}>
          <EmptyState icon="👤" title="No post data yet" description="Sync posts to see creator rankings." />
        </div>
      ) : (
        <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
          <div style={{ minWidth: 460 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "28px 1fr 64px 84px 72px 96px",
              gap: 12,
              padding: "10px 24px",
              borderBottom: "1px solid var(--cc-border)",
            }}
          >
            {["", "Creator", "Camps", "Views", "Eng.", "EMV"].map((h, i) => (
              <span
                key={i}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--cc-text-subtle)",
                  textTransform: "uppercase",
                  letterSpacing: 0.4,
                  textAlign: i >= 2 ? "right" : "left",
                }}
              >
                {h}
              </span>
            ))}
          </div>
          {creators.map((creator, i) => (
            <Link
              key={creator.id}
              href={`/creators/${creator.id}`}
              style={{
                display: "grid",
                gridTemplateColumns: "28px 1fr 64px 84px 72px 96px",
                gap: 12,
                padding: "12px 24px",
                alignItems: "center",
                borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 700, color: i < 3 ? "var(--cc-primary)" : "var(--cc-text-subtle)", textAlign: "center" }}>
                {i + 1}
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                <Avatar name={creator.name} src={creator.avatarUrl ?? undefined} size="sm" />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", lineHeight: 1.3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{creator.name}</p>
                  <p style={{ fontSize: 11, color: "var(--cc-text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>@{creator.handle}</p>
                </div>
              </div>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", textAlign: "right" }}>{creator.campaigns}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", textAlign: "right" }}>{formatNumber(creator.views)}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", textAlign: "right" }}>{formatPercent(creator.engagementRate)}</span>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", textAlign: "right" }}>{formatCurrency(creator.emv)}</span>
            </Link>
          ))}
          </div>
        </div>
      )}
    </Card>
  );
}
