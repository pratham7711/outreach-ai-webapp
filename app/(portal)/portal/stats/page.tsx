"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { InsightsPost, PlatformInsights } from "@/lib/portal/creatorInsights";
import {
  ButtonLink,
  Card,
  EmptyState,
  LoadFailed,
  Screen,
  SectionTitle,
  SkeletonBlock,
  SourceLabel,
  StatusPill,
  formatCount,
  formatDay,
  platformLabel,
} from "@/components/portal/app/ui";

type TrendPoint = { day: string; followers: number };
type Trend = { platform: string; handle: string; source: "public_profile"; points: TrendPoint[] };
type CampaignPost = {
  id: string;
  platform: string;
  postUrl: string;
  caption: string | null;
  postedAt: string;
  campaignTitle: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  reach: number | null;
  saves: number | null;
};

/** Every block says where its numbers came from, in the creator's words. */
const INSIGHTS_SOURCE: Record<PlatformInsights["platform"], string> = {
  TIKTOK: "From TikTok · your connected account",
  INSTAGRAM: "From Instagram · insights",
  YOUTUBE: "From YouTube · your connected channel",
  FACEBOOK: "From Facebook · Page insights",
  THREADS: "From Threads · your connected account",
};

const RECENT_POSTS = 5;

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{label}</div>
    </div>
  );
}

function PostLine({ post, showComments }: { post: InsightsPost; showComments: boolean }) {
  const caption = post.caption?.trim() || "Untitled post";
  const body = (
    <>
      <span style={{ display: "block", fontSize: 14, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {caption}
      </span>
      <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-muted)" }}>
        {formatDay(post.postedAt)} · {formatCount(post.views)} views · {formatCount(post.likes)} likes
        {showComments && <> · {formatCount(post.comments)} comments</>}
      </span>
    </>
  );
  return (
    <li style={{ padding: "10px 0", borderBottom: "1px solid var(--cc-border)", minWidth: 0 }}>
      {post.shareUrl ? (
        <a href={post.shareUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "block" }}>
          {body}
        </a>
      ) : (
        body
      )}
    </li>
  );
}

function AccountBlock({ block }: { block: PlatformInsights }) {
  const posts = block.posts.slice(0, RECENT_POSTS);
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>{platformLabel(block.platform)}</h2>
          <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "2px 0 0", overflowWrap: "anywhere" }}>{block.handle}</p>
        </div>
        {block.needsReconnect && <StatusPill tone="warning">Reconnect needed</StatusPill>}
      </div>

      {block.needsReconnect ? (
        <div style={{ marginTop: 12 }}>
          <p style={{ fontSize: 14, color: "var(--cc-text)", margin: "0 0 10px" }}>
            Access to this account has lapsed, so we can&apos;t read its numbers. Reconnect it to see them again.
          </p>
          <ButtonLink href="/portal/accounts">Go to My accounts</ButtonLink>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginTop: 14 }}>
            <Figure label="Followers" value={formatCount(block.followers)} />
            <Figure label={`Median views, last ${block.sampleSize}`} value={formatCount(block.medianViews)} />
            <Figure label="Best post views" value={formatCount(block.bestPost?.views ?? null)} />
          </div>
          {posts.length > 0 ? (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "16px 0 0" }}>Recent posts</h3>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {posts.map((p) => (
                  <PostLine key={p.id} post={p} showComments={block.platform === "FACEBOOK" || block.platform === "YOUTUBE"} />
                ))}
              </ul>
            </>
          ) : (
            <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "14px 0 0" }}>No recent posts came back from this account.</p>
          )}
        </>
      )}
      <SourceLabel>{INSIGHTS_SOURCE[block.platform]}</SourceLabel>
    </Card>
  );
}

/** A plain line for the followers trend. No chart library: one series, drawn
    in the theme's own primary, with the first and last readings written out
    so the line never has to be read for a number. */
function TrendLine({ trend }: { trend: Trend }) {
  const pts = trend.points;
  const first = pts[0];
  const last = pts[pts.length - 1];
  const W = 320;
  const H = 72;
  const values = pts.map((p) => p.followers);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const path = pts
    .map((p, i) => {
      const x = pts.length === 1 ? W / 2 : (i / (pts.length - 1)) * W;
      const y = H - 4 - ((p.followers - min) / span) * (H - 8);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const change = last.followers - first.followers;

  return (
    <div style={{ padding: "12px 0", borderBottom: "1px solid var(--cc-border)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflowWrap: "anywhere" }}>
          {platformLabel(trend.platform)} · {trend.handle}
        </span>
        <span style={{ fontSize: 13, color: "var(--cc-text)" }}>
          {formatCount(last.followers)} followers
          {pts.length > 1 && (
            <span style={{ color: "var(--cc-text-muted)" }}>
              {" "}
              ({change >= 0 ? "+" : "−"}
              {formatCount(Math.abs(change))} since {formatDay(first.day)})
            </span>
          )}
        </span>
      </div>
      {pts.length > 1 ? (
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Followers from ${formatDay(first.day)} to ${formatDay(last.day)}`}
          style={{ width: "100%", height: H, marginTop: 8, display: "block" }}
        >
          <path d={path} fill="none" style={{ stroke: "var(--cc-primary)" }} strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
      ) : (
        <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "6px 0 0" }}>One reading so far, on {formatDay(first.day)}. The line starts with the next.</p>
      )}
    </div>
  );
}

function CampaignPostLine({ post }: { post: CampaignPost }) {
  const parts = [
    `${formatCount(post.views)} views`,
    `${formatCount(post.likes)} likes`,
    `${formatCount(post.comments)} comments`,
  ];
  if (post.platform === "INSTAGRAM") {
    parts.push(`${formatCount(post.reach)} reach`, `${formatCount(post.saves)} saves`);
  }
  return (
    <li style={{ padding: "10px 0", borderBottom: "1px solid var(--cc-border)", minWidth: 0 }}>
      <a href={post.postUrl} target="_blank" rel="noreferrer" style={{ textDecoration: "none", display: "block" }}>
        <span style={{ display: "block", fontSize: 14, fontWeight: 600, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {post.campaignTitle}
        </span>
        <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-muted)" }}>
          {platformLabel(post.platform)} · {formatDay(post.postedAt)}
        </span>
        <span style={{ display: "block", fontSize: 13, color: "var(--cc-text)", marginTop: 2 }}>{parts.join(" · ")}</span>
      </a>
    </li>
  );
}

/**
 * My stats: the creator's own numbers, each block labelled with where it came
 * from. Connected accounts are read live (/api/portal/insights); the followers
 * trend and campaign posts come from our own readings (/api/portal/stats). A
 * number the platform did not measure is a dash, never 0 (lib/metricDisplay).
 */
export default function MyStatsPage() {
  const router = useRouter();
  const [insights, setInsights] = useState<PlatformInsights[] | null>(null);
  const [stats, setStats] = useState<{ trends: Trend[]; campaignPosts: CampaignPost[] } | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [insRes, statsRes] = await Promise.all([fetch("/api/portal/insights"), fetch("/api/portal/stats")]);
      if (insRes.status === 401 || statsRes.status === 401) {
        router.push("/portal/login");
        return;
      }
      if (!insRes.ok || !statsRes.ok) throw new Error("stats");
      const ins = await insRes.json();
      setInsights(ins.platforms ?? []);
      setStats(await statsRes.json());
    } catch {
      setFailed(true);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const loading = !failed && (!insights || !stats);
  const nothing = insights && stats && insights.length === 0 && stats.trends.length === 0 && stats.campaignPosts.length === 0;
  const hasInstagramPosts = stats?.campaignPosts.some((p) => p.platform === "INSTAGRAM") ?? false;

  return (
    <Screen title="My stats" subtitle="Your numbers, and where each one came from.">
      {failed && <LoadFailed what="your stats" onRetry={load} />}
      {loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <SkeletonBlock height={160} />
          <SkeletonBlock height={120} />
        </div>
      )}
      {nothing && (
        <EmptyState
          title="No numbers yet"
          body="Connect an account and its followers and recent posts show up here."
          action={{ label: "Connect an account", href: "/portal/accounts" }}
        />
      )}
      {insights && stats && !nothing && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {insights.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {insights.map((block) => (
                <AccountBlock key={block.accountId} block={block} />
              ))}
            </div>
          ) : (
            <EmptyState
              title="No connected accounts"
              body="Connect one to see its recent posts and best post here."
              action={{ label: "Connect an account", href: "/portal/accounts" }}
            />
          )}

          {stats.trends.length > 0 && (
            <Card>
              <SectionTitle>Followers over time</SectionTitle>
              {stats.trends.map((t) => (
                <TrendLine key={`${t.platform}-${t.handle}`} trend={t} />
              ))}
              <SourceLabel>From your public profile · read by our tracker</SourceLabel>
            </Card>
          )}

          {stats.campaignPosts.length > 0 && (
            <Card>
              <SectionTitle>Your campaign posts</SectionTitle>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {stats.campaignPosts.map((p) => (
                  <CampaignPostLine key={p.id} post={p} />
                ))}
              </ul>
              <SourceLabel>
                From each post as we read it for the campaign
                {hasInstagramPosts && <> · reach and saves from Instagram insights on your campaign posts</>}
              </SourceLabel>
            </Card>
          )}
        </div>
      )}
    </Screen>
  );
}
