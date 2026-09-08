"use client";
import { Modal, Badge } from "@pratham7711/ui";
import { RefreshCw, User } from "lucide-react";
import { formatCompact, timeAgo } from "@/lib/format";
import { AudioUsesChart, type SeriesPoint } from "./SoundCharts";
import type { ChartGranularity } from "@/lib/trackers/granularity";

/**
 * The creator detail, matching the reference's ?tracker=<id> modal: the figure,
 * its change at several horizons, and a Refresh Data button.
 *
 * The reference shows 7/14/30-Day Change here and, on the account we compared
 * against, every one of them reads 0 for every creator -- it displays two numbers
 * it cannot trend. This shows a real change where there is history for one, and
 * says which of the several different "no" it is where there is not.
 */

export type DetailCreator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  avatarUrl: string | null;
  followersCount: number | null;
  followersChangePercent: number | null;
  followersDelta: number | null;
  lastReadAt: string | null;
  health: "pending" | "live" | "regressed" | "stale";
  readError: string | null;
  series: { value: number; recordedAt: string }[];
  chartGranularity: ChartGranularity;
  snapshotCount: number;
  metrics: { avgViews: number | null; postsInWindow: number };
  topPosts?: TopPost[] | null;
  topPostsAt?: string | null;
  /** "platform" = the creator's own catalogue; "campaigns" = only the posts
   *  this workspace tracks with them. Two different claims, so the heading
   *  changes rather than letting the narrower one read as the broader one. */
  topPostsSource?: "platform" | "campaigns" | null;
};

/** Matches the shape the sweep stores in Creator.topPosts. */
export type TopPost = {
  postId: string;
  url: string | null;
  caption: string | null;
  coverUrl: string | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  postedAt: string | null;
};

export function CreatorDetailModal({
  creator,
  open,
  onClose,
  onRefresh,
  refreshing = false,
}: {
  creator: DetailCreator | null;
  open: boolean;
  onClose: () => void;
  onRefresh?: (creatorId: string) => void;
  refreshing?: boolean;
}) {
  if (!creator) return null;
  const stale = creator.health !== "live";

  const series: SeriesPoint[] = creator.series.map((p) => ({
    value: p.value,
    recordedAt: p.recordedAt,
  }));

  return (
    <Modal open={open} onClose={onClose} title="" size="lg">
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        {creator.avatarUrl ? (
          <img
            src={creator.avatarUrl}
            alt=""
            style={{ width: 52, height: 52, borderRadius: "50%", objectFit: "cover", flexShrink: 0 }}
          />
        ) : (
          <div
            style={{
              width: 52, height: 52, borderRadius: "50%", flexShrink: 0,
              display: "flex", alignItems: "center", justifyContent: "center",
              background: "var(--cc-primary-light)",
            }}
          >
            <User size={22} style={{ color: "var(--cc-primary)" }} />
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}>{creator.name}</div>
          <div style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
            @{creator.handle} · {creator.platform}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 }}>
          {onRefresh ? (
            <button
              onClick={() => onRefresh(creator.id)}
              disabled={refreshing}
              title="Read this creator's figures now"
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 12px", borderRadius: 8, fontSize: 13, fontWeight: 600,
                border: "1px solid var(--cc-border)", background: "var(--cc-card)",
                color: "var(--cc-text)", cursor: refreshing ? "default" : "pointer",
                opacity: refreshing ? 0.6 : 1,
              }}
            >
              <RefreshCw size={14} style={{ animation: refreshing ? "cc-spin 1s linear infinite" : undefined }} />
              {refreshing ? "Refreshing…" : "Refresh Data"}
            </button>
          ) : null}
          <Badge variant={stale ? "warning" : "success"} size="sm">
            {creator.health === "pending" ? "awaiting first reading" : stale ? "not updating" : "live"}
          </Badge>
        </div>
      </div>

      {/* The reason the figures are what they are, stated once and plainly,
          rather than repeated as a blank in every cell below. */}
      {creator.readError ? (
        <div
          role="status"
          style={{
            borderLeft: "3px solid var(--cc-warning)", background: "var(--cc-card)",
            padding: "10px 14px", marginBottom: 18, fontSize: 13, color: "var(--cc-text)",
          }}
        >
          {creator.readError}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <Figure label="Followers" value={creator.followersCount === null ? "—" : formatCompact(creator.followersCount)} />
        <Figure
          label="Change"
          value={
            creator.followersChangePercent === null
              ? "No data yet."
              : `${creator.followersChangePercent >= 0 ? "+" : ""}${creator.followersChangePercent.toFixed(2)}%`
          }
          muted={creator.followersChangePercent === null}
        />
        <Figure
          label="Avg. Views"
          value={creator.metrics.avgViews === null ? "—" : formatCompact(Math.round(creator.metrics.avgViews))}
        />
        <Figure label="Readings" value={String(creator.snapshotCount)} />
      </div>

      {creator.topPosts?.length ? (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>
              {creator.topPostsSource === "campaigns" ? "Top Posts in Your Campaigns" : "Top Posts"}
            </div>
            {creator.topPostsAt ? (
              <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>
                as of {timeAgo(creator.topPostsAt)}
              </div>
            ) : null}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
              gap: 10,
            }}
          >
            {creator.topPosts.map((post) => (
              <a
                key={post.postId}
                href={post.url ?? undefined}
                target="_blank"
                rel="noreferrer"
                style={{
                  border: "1px solid var(--cc-border)", borderRadius: 12, overflow: "hidden",
                  textDecoration: "none", color: "var(--cc-text)", display: "block",
                  background: "var(--cc-card)",
                }}
              >
                {post.coverUrl ? (
                  <img
                    src={post.coverUrl}
                    alt=""
                    style={{ width: "100%", aspectRatio: "9 / 12", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <div
                    style={{
                      width: "100%", aspectRatio: "9 / 12",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      background: "var(--cc-primary-light)",
                      fontSize: 12, color: "var(--cc-text-muted)", padding: 8, textAlign: "center",
                    }}
                  >
                    {post.caption ? post.caption.slice(0, 60) : "No preview"}
                  </div>
                )}
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--cc-primary)" }}>
                    {post.views !== null ? `${formatCompact(post.views)} views` : "views unavailable"}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>
                    {[
                      post.likes !== null ? `${formatCompact(post.likes)} likes` : null,
                      post.comments !== null ? `${formatCompact(post.comments)} comments` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || (post.postedAt ? timeAgo(post.postedAt) : "")}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      ) : null}

      {series.length >= 2 ? (
        <AudioUsesChart series={series} granularity={creator.chartGranularity} unit="followers" />
      ) : (
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
          {/* Two points is the minimum for a line to mean anything; drawing one
              would imply a flat trend we have not measured. */}
          A chart appears once there are at least two readings.
          {creator.lastReadAt ? ` Last read ${timeAgo(creator.lastReadAt)}.` : ""}
        </p>
      )}
    </Modal>
  );
}

function Figure({ label, value, muted = false }: { label: string; value: string; muted?: boolean }) {
  return (
    <div
      style={{
        border: "1px solid var(--cc-border)", borderRadius: 12,
        padding: "10px 16px", flex: "1 1 150px", minWidth: 140,
      }}
    >
      <div style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>{label}</div>
      <div
        style={{
          fontSize: muted ? 12 : 18,
          fontWeight: 700,
          color: muted ? "var(--cc-text-subtle)" : "var(--cc-primary)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
