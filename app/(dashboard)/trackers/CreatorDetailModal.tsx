"use client";
import { useQuery } from "@tanstack/react-query";
import { Modal, Badge, Skeleton } from "@pratham7711/ui";
import { RefreshCw } from "lucide-react";
import { timeAgo, formatFull, formatHandle } from "@/lib/format";
import { apiFetch } from "@/lib/api/client";
import { AudioUsesChart, type SeriesPoint } from "./SoundCharts";
import { changeOver } from "./horizonChange";
import type { ChartGranularity } from "@/lib/trackers/granularity";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import MetricFigure from "@/components/creators/MetricFigure";
import {
  avgViewsValue,
  followersValue,
  isUnknownMetric,
  metricReason,
  type MetricValue,
} from "@/lib/creators/metricValue";

/**
 * The creator detail, matching the reference's ?tracker=<id> modal: a Followers
 * card and an Average Views card, each with its 7-, 14- and 30-day change and a
 * chart, and a Refresh Data button.
 *
 * The changes come from the creator's own 31-day history rather than the list's
 * readings, which cover only the selected period -- a 30-Day Change taken from
 * seven days of readings would be the seven-day change under a wrong label.
 * Where the history does not reach back far enough, the cell says so.
 */

const HORIZONS: { label: string; days: number }[] = [
  { label: "7-Day Change", days: 7 },
  { label: "14-Day Change", days: 14 },
  { label: "30-Day Change", days: 30 },
];

type CreatorHistory = {
  followers: SeriesPoint[];
  views: SeriesPoint[];
  chartGranularity: ChartGranularity;
};

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
  snapshotCount: number;
  /** Their ten newest posts, pinned ones left out, at the latest reading. */
  views: { avgViews: number | null; measuredAt: string | null };
  /** Only the posts this workspace tracks with them, over the list's period. */
  metrics: { avgViews: number | null; postsInWindow: number };
  topPosts?: TopPost[] | null;
  topPostsAt?: string | null;
  /** "platform" = the creator's own catalogue; "campaigns" = only the posts
   *  this workspace tracks with them. Two different claims, so the heading
   *  changes rather than letting the narrower one read as the broader one. */
  topPostsSource?: "platform" | "campaigns" | null;
};

/**
 * The two headline figures, or why each is missing (plan A1). The list's card
 * and this modal both read them from here, so they give the same reason. A
 * reading of 0 followers is a reading that did not carry the count, never an
 * empty account.
 */
export function trackedFigures(c: {
  followersCount: number | null;
  readError: string | null;
  snapshotCount: number;
  lastAttemptAt?: string | null;
  views: { avgViews: number | null };
}): { followers: MetricValue; avgViews: MetricValue } {
  return {
    followers: followersValue(c.followersCount, {
      readError: c.readError,
      readings: c.snapshotCount,
      attemptedAt: c.lastAttemptAt ?? null,
    }),
    avgViews: avgViewsValue(c.views.avgViews === null ? null : Math.round(c.views.avgViews), {
      readError:
        c.readError ?? "We have not measured this creator's recent posts yet. Posts are read once a day.",
    }),
  };
}

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
  const creatorId = creator?.id ?? null;
  const history = useQuery({
    queryKey: ["creator-trackers", "history", creatorId],
    queryFn: () => apiFetch<CreatorHistory>(`/api/trackers/creators/${creatorId}`),
    enabled: open && creatorId !== null,
  });

  if (!creator) return null;
  const stale = creator.health !== "live";
  const figures = trackedFigures(creator);

  return (
    <Modal open={open} onClose={onClose} title="" size="lg">
      <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 20 }}>
        <CreatorAvatar id={creator.id} name={creator.name} size="lg" />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: "var(--cc-t-20)", fontWeight: 700, color: "var(--cc-text)" }}>{creator.name}</div>
          <div style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
            {formatHandle(creator.handle)} · {creator.platform}
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
                padding: "6px 12px", borderRadius: 8, fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)",
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
            padding: "10px 14px", marginBottom: 18, fontSize: "var(--cc-t-13)", color: "var(--cc-text)",
          }}
        >
          {creator.readError}
        </div>
      ) : null}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))",
          gap: 14,
          marginBottom: 14,
        }}
      >
        <MetricCard
          title="Followers"
          value={figures.followers}
          note={metricReason(figures.followers)}
          unit="followers"
          series={history.data?.followers}
          granularity={history.data?.chartGranularity}
          loading={history.isPending}
          failed={history.isError}
        />
        <MetricCard
          title="Average Views"
          value={figures.avgViews}
          note={
            isUnknownMetric(figures.avgViews)
              ? figures.avgViews.reason
              : `Their 10 newest posts, pinned posts left out · measured ${timeAgo(creator.views.measuredAt)}`
          }
          unit="avg. views"
          series={history.data?.views}
          granularity={history.data?.chartGranularity}
          loading={history.isPending}
          failed={history.isError}
        />
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 20 }}>
        <Figure
          label="Avg. Views in your campaigns"
          value={creator.metrics.avgViews === null ? "—" : formatFull(Math.round(creator.metrics.avgViews))}
          title={`${creator.metrics.postsInWindow} post${creator.metrics.postsInWindow === 1 ? "" : "s"} tracked with them in the selected period`}
        />
        <Figure label="Readings" value={String(creator.snapshotCount)} />
      </div>

      {creator.topPosts?.length ? (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
            <div style={{ fontSize: "var(--cc-t-13)", fontWeight: 700, color: "var(--cc-text)" }}>
              {creator.topPostsSource === "campaigns" ? "Top Posts in Your Campaigns" : "Top Posts"}
            </div>
            {creator.topPostsAt ? (
              <div style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-muted)" }}>
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
                      fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", padding: 8, textAlign: "center",
                    }}
                  >
                    {post.caption ? post.caption.slice(0, 60) : "No preview"}
                  </div>
                )}
                <div style={{ padding: "8px 10px" }}>
                  <div style={{ fontSize: "var(--cc-t-12)", fontWeight: 700, color: "var(--cc-primary)" }}>
                    {post.views !== null ? `${formatFull(post.views)} views` : "views unavailable"}
                  </div>
                  <div style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-muted)" }}>
                    {[
                      post.likes !== null ? `${formatFull(post.likes)} likes` : null,
                      post.comments !== null ? `${formatFull(post.comments)} comments` : null,
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

      {creator.lastReadAt ? (
        <div style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>
          Last read {timeAgo(creator.lastReadAt)}
        </div>
      ) : null}
    </Modal>
  );
}

/** One CreatorCore-style card: the current figure, its changes, and its chart. */
function MetricCard({
  title,
  value,
  note,
  unit,
  series,
  granularity,
  loading,
  failed,
}: {
  title: string;
  value: MetricValue;
  note?: string;
  unit: string;
  series: SeriesPoint[] | undefined;
  granularity: ChartGranularity | undefined;
  loading: boolean;
  failed: boolean;
}) {
  return (
    <section
      style={{
        background: "var(--cc-card)", border: "1px solid var(--cc-border)",
        borderRadius: 12, padding: 16, minWidth: 0,
      }}
    >
      <h3 style={{ fontSize: "var(--cc-t-14)", fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
        {title}
      </h3>
      <div style={{ fontSize: "var(--cc-t-24)", fontWeight: 700, color: "var(--cc-primary)" }}>
        <MetricFigure value={value} />
      </div>
      {note ? (
        <div style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-muted)", marginTop: 2 }}>{note}</div>
      ) : null}

      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", margin: "12px 0" }}>
        {HORIZONS.map((h) => (
          <div key={h.label} style={{ minWidth: 84 }}>
            <div style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-muted)" }}>{h.label}</div>
            {loading ? (
              <Skeleton width={64} height={16} />
            ) : (
              <HorizonValue change={series ? changeOver(series, h.days) : null} days={h.days} />
            )}
          </div>
        ))}
      </div>

      {loading ? (
        <Skeleton width="100%" height={200} />
      ) : failed ? (
        <p role="alert" style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
          Could not load this creator&apos;s history. Close and reopen to try again.
        </p>
      ) : series && granularity && series.length >= 2 ? (
        <AudioUsesChart series={series} granularity={granularity} height={200} unit={unit} />
      ) : (
        <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)" }}>
          {/* Two points is the minimum for a line to mean anything; drawing one
              would imply a flat trend we have not measured. */}
          A chart appears once there are at least two readings.
        </p>
      )}
    </section>
  );
}

function HorizonValue({ change, days }: { change: ReturnType<typeof changeOver>; days: number }) {
  if (change === "short-history") {
    return (
      <div
        style={{ fontSize: "var(--cc-t-14)", fontWeight: 700, color: "var(--cc-text-muted)" }}
        title={`Not enough history — there is no reading from ${days} days ago yet.`}
      >
        —
      </div>
    );
  }
  if (!change) {
    return <div style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>No data yet.</div>;
  }
  const rounded = Math.round(change.added);
  return (
    <div style={{ fontSize: "var(--cc-t-14)", fontWeight: 700, color: rounded < 0 ? "var(--cc-danger)" : "var(--cc-text)" }}>
      {rounded >= 0 ? "+" : ""}
      {formatFull(rounded)}
      {change.percent !== null ? (
        <span style={{ fontSize: "var(--cc-t-11)", fontWeight: 500, color: "var(--cc-text-muted)", marginLeft: 4 }}>
          {change.percent >= 0 ? "+" : ""}
          {change.percent.toFixed(2)}%
        </span>
      ) : null}
    </div>
  );
}

function Figure({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div
      title={title}
      style={{
        border: "1px solid var(--cc-border)", borderRadius: 12,
        padding: "10px 16px", flex: "1 1 150px", minWidth: 140,
      }}
    >
      <div style={{ fontSize: "var(--cc-t-11)", color: "var(--cc-text-muted)" }}>{label}</div>
      <div
        style={{
          fontSize: 18,
          fontWeight: 700,
          color: "var(--cc-primary)",
        }}
      >
        {value}
      </div>
    </div>
  );
}
