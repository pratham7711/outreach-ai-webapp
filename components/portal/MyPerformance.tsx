"use client";

import React from "react";
import { useEffect, useState } from "react";
import { Card, Skeleton } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { BadgeCheck, ExternalLink } from "lucide-react";
import { ConnectPrompt } from "./ConnectPrompt";

type Post = {
  id: string;
  caption: string | null;
  /** Null when the platform did not measure it; the counter is then omitted. */
  views: number | null;
  likes: number;
  comments: number;
  shares: number;
  postedAt: string;
  shareUrl: string | null;
  coverImageUrl: string | null;
};

type PlatformEnum = "TIKTOK" | "INSTAGRAM" | "YOUTUBE" | "FACEBOOK" | "THREADS";

type PlatformInsights = {
  accountId: string;
  platform: PlatformEnum;
  connected: boolean;
  needsReconnect: boolean;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  profileUrl: string | null;
  isVerified: boolean;
  followers: number | null;
  following: number | null;
  totalLikes: number | null;
  mediaCount: number | null;
  sampleSize: number;
  totalViews: number | null;
  medianViews: number | null;
  bestPost: Post | null;
  posts: Post[];
};

type Insights = {
  connected: boolean;
  platforms: PlatformInsights[];
};

/** Label, and the slug the OAuth start route expects. */
const PLATFORM_META: Record<PlatformEnum, { label: string; slug: string }> = {
  TIKTOK: { label: "TikTok", slug: "tiktok" },
  INSTAGRAM: { label: "Instagram", slug: "instagram" },
  YOUTUBE: { label: "YouTube", slug: "youtube" },
  FACEBOOK: { label: "Facebook", slug: "facebook" },
  THREADS: { label: "Threads", slug: "threads" },
};

const compact = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(n);

/**
 * The header stats, in display order. A stat the platform did not report is
 * left out of the grid rather than shown as a dash: Threads and Facebook Pages
 * expose no following, total-likes or lifetime post count, and Instagram
 * withholds views on media published before the account became a Business
 * account. Three dashes in a six-cell grid read as a broken page; three real
 * numbers read as the page. Never coerced to 0 — that would be a measurement
 * nobody made.
 */
const STATS: ReadonlyArray<[string, (b: PlatformInsights) => number | null]> = [
  ["Followers", (b) => b.followers],
  ["Following", (b) => b.following],
  ["Total likes", (b) => b.totalLikes],
  ["Views (recent posts)", (b) => b.totalViews],
  ["Median views per post", (b) => b.medianViews],
  ["Posts published", (b) => b.mediaCount],
];

/** "1.2K views · 40 likes · 3 comments · 2 shares", skipping unmeasured views. */
function counters(p: Post): string {
  const parts = [
    typeof p.views === "number" ? `${compact(p.views)} views` : null,
    `${compact(p.likes)} likes`,
    `${compact(p.comments)} comments`,
    `${compact(p.shares)} shares`,
  ];
  return parts.filter((x): x is string => x !== null).join(" · ");
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}>{value}</div>
    </div>
  );
}

function PlatformHeader({ block }: { block: PlatformInsights }) {
  const meta = PLATFORM_META[block.platform];
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 12,
        marginBottom: 16,
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 700,
          color: "var(--cc-text)",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
        }}
      >
        {meta.label}
        {block.isVerified && (
          <BadgeCheck size={14} color="var(--cc-primary)" aria-label="Verified" />
        )}
      </div>
      <div style={{ fontSize: 12, color: "var(--cc-text-subtle)" }}>
        {block.profileUrl ? (
          <a
            href={block.profileUrl}
            target="_blank"
            rel="noreferrer"
            style={{ color: "var(--cc-text-subtle)" }}
          >
            {block.handle}
          </a>
        ) : (
          block.handle
        )}
        {block.sampleSize > 0 && <> &middot; last {block.sampleSize} public posts</>}
      </div>
    </div>
  );
}

/** The creator's own bio, as the platform returns it. */
function Bio({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p
      style={{
        fontSize: 13,
        color: "var(--cc-text-muted)",
        marginTop: -8,
        marginBottom: 16,
        whiteSpace: "pre-wrap",
      }}
    >
      {text}
    </p>
  );
}

function PlatformBlock({ block }: { block: PlatformInsights }) {
  const meta = PLATFORM_META[block.platform];

  if (block.needsReconnect) {
    return (
      <Card variant="outlined" style={{ padding: 20 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", marginBottom: 6 }}>
          Reconnect {meta.label}
        </div>
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginBottom: 14 }}>
          Your {meta.label} authorisation has lapsed, so we can&rsquo;t refresh the numbers for{" "}
          {block.handle}.
        </p>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            window.location.href = `/api/portal/connections/${meta.slug}/start?returnTo=%2Fportal%2Fdashboard`;
          }}
        >
          Reconnect {meta.label}
        </Button>
      </Card>
    );
  }

  if (block.sampleSize === 0) {
    return (
      <Card variant="outlined" style={{ padding: 20 }}>
        <PlatformHeader block={block} />
        <Bio text={block.bio} />
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
          {meta.label} is connected. Publish a public post and your performance will show up here
          automatically.
        </p>
      </Card>
    );
  }

  return (
    <Card variant="outlined" style={{ padding: 20 }}>
      <PlatformHeader block={block} />
      <Bio text={block.bio} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 16,
          marginBottom: 20,
        }}
      >
        {STATS.filter(([, pick]) => typeof pick(block) === "number").map(([label, pick]) => (
          <Stat key={label} label={label} value={compact(pick(block) as number)} />
        ))}
      </div>

      {block.bestPost && (
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 10,
            background: "var(--cc-bg)",
            marginBottom: 16,
          }}
        >
          <div style={{ fontSize: 12, color: "var(--cc-text-muted)", marginBottom: 4 }}>
            Best performing post &middot; {counters(block.bestPost)}
          </div>
          <div style={{ fontSize: 13, color: "var(--cc-text)", display: "flex", gap: 8 }}>
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                flex: 1,
              }}
            >
              {block.bestPost.caption ?? "Untitled post"}
            </span>
            {block.bestPost.shareUrl && (
              <a
                href={block.bestPost.shareUrl}
                target="_blank"
                rel="noreferrer"
                style={{
                  color: "var(--cc-primary)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                }}
              >
                View <ExternalLink size={11} />
              </a>
            )}
          </div>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {block.posts.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: 12,
              fontSize: 13,
              color: "var(--cc-text-muted)",
            }}
          >
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                color: "var(--cc-text)",
              }}
            >
              {p.caption ?? "Untitled post"}
            </span>
            <span style={{ whiteSpace: "nowrap" }}>{counters(p)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/**
 * The creator's own performance, one card per connected platform.
 *
 * This rendered a single TikTok card, because `/api/portal/insights` only ever
 * returned TikTok. It now maps over whatever the creator has connected, so a
 * creator with Instagram and YouTube linked sees both — and so does a reviewer
 * watching a screencast of the permission that fetched it.
 *
 * Keyed on the account rather than the platform, because a creator may link
 * more than one account on the same platform and two TikTok cards would
 * otherwise collide on the same React key.
 */
export function MyPerformance() {
  const [data, setData] = useState<Insights | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetch("/api/portal/insights")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("failed"))))
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return null;
  if (!data) return <Skeleton width="100%" height="160px" borderRadius="12px" />;

  const platforms = data.platforms ?? [];
  if (!data.connected || platforms.length === 0) {
    return <ConnectPrompt variant="banner" returnTo="/portal/dashboard" />;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {platforms.map((block) => (
        <PlatformBlock key={block.accountId} block={block} />
      ))}
    </div>
  );
}
