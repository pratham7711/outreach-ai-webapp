"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { InsightsPost, PlatformInsights } from "@/lib/portal/creatorInsights";
import { META_MINIMUM_SIZE_NOTE, META_UNAVAILABLE, isMetaPlatform } from "@/lib/metricDisplay";
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

/** What the platform calls the account's post count. */
const MEDIA_LABEL: Record<PlatformInsights["platform"], string> = {
  TIKTOK: "Videos",
  INSTAGRAM: "Posts",
  YOUTUBE: "Videos",
  FACEBOOK: "Posts",
  THREADS: "Posts",
};

const PROFILE_LINK_LABEL: Record<PlatformInsights["platform"], string> = {
  TIKTOK: "Open on TikTok",
  INSTAGRAM: "Open on Instagram",
  YOUTUBE: "Open on YouTube",
  FACEBOOK: "Open on Facebook",
  THREADS: "Open on Threads",
};

/** A figure, or on Instagram and Facebook one Meta did not return, which
    says so rather than showing a dash that reads as a failed fetch. */
function Figure({ label, value, meta = false }: { label: string; value: number | null; meta?: boolean }) {
  const withheld = meta && value === null;
  return (
    <div style={{ minWidth: 0 }} title={withheld ? META_MINIMUM_SIZE_NOTE : undefined}>
      {withheld ? (
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: "26px", color: "var(--cc-text-muted)" }}>{META_UNAVAILABLE}</div>
      ) : (
        <div style={{ fontSize: 20, fontWeight: 700, color: "var(--cc-text)" }}>{formatCount(value)}</div>
      )}
      <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{label}</div>
    </div>
  );
}

/** "Oct 2 · 1.2K views · 40 likes · 3 comments · 2 shares · 900 reach". Views
    stay in the line as a dash when unmeasured, so rows line up; shares and
    reach are only reported on some media, so an unmeasured one is left out
    rather than written as 0. */
function counted(n: number | null, noun: string): string {
  return `${formatCount(n)} ${n === 1 ? noun : `${noun}s`}`;
}

function postCounters(post: InsightsPost): string {
  const parts = [
    formatDay(post.postedAt),
    counted(post.views, "view"),
    counted(post.likes, "like"),
    counted(post.comments, "comment"),
  ];
  if (typeof post.shares === "number") parts.push(counted(post.shares, "share"));
  if (typeof post.reach === "number") parts.push(`${formatCount(post.reach)} reach`);
  return parts.join(" · ");
}

function PostLine({ post }: { post: InsightsPost }) {
  const caption = post.caption?.trim() || "Untitled post";
  const body = (
    <>
      <span style={{ display: "block", fontSize: 14, color: "var(--cc-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {caption}
      </span>
      <span style={{ display: "block", fontSize: 12, color: "var(--cc-text-muted)" }}>{postCounters(post)}</span>
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

/** The account's picture. Platform avatar URLs are signed and expire (TikTok's
    within days), so a dead one falls back to the name's first letter instead
    of a broken image. */
function Avatar({ src, name }: { src: string | null; name: string }) {
  const [broken, setBroken] = useState(false);
  const size = 44;
  if (src && !broken) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        onError={() => setBroken(true)}
        style={{ width: size, height: size, borderRadius: "50%", objectFit: "cover", flexShrink: 0, background: "var(--cc-bg)" }}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        borderRadius: "50%",
        flexShrink: 0,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--cc-bg)",
        border: "1px solid var(--cc-border)",
        fontSize: 16,
        fontWeight: 700,
        color: "var(--cc-text-muted)",
      }}
    >
      {name.replace(/^@/, "").charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** Who the connected account is, as the platform describes it: picture, name,
    username, verified status, bio and a link out to the profile. */
function ProfileHeader({ block }: { block: PlatformInsights }) {
  /* A Facebook Page with no username is stored under its name, which is not
     an @handle. */
  const handle = block.handle.startsWith("@") || /\s/.test(block.handle) ? block.handle : `@${block.handle}`;
  const name = block.displayName?.trim() || handle;
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", minWidth: 0 }}>
      <Avatar src={block.avatarUrl} name={name} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 16, fontWeight: 700, color: "var(--cc-text)", overflowWrap: "anywhere" }}>{name}</span>
          {block.isVerified && <StatusPill tone="info">Verified</StatusPill>}
        </div>
        <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: "2px 0 0", overflowWrap: "anywhere" }}>
          {platformLabel(block.platform)} · {handle}
          {block.profileUrl && (
            <>
              {" · "}
              <a href={block.profileUrl} target="_blank" rel="noreferrer" style={{ color: "var(--cc-primary)", fontWeight: 600, textDecoration: "none" }}>
                {PROFILE_LINK_LABEL[block.platform]}
              </a>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

function AccountBlock({ block }: { block: PlatformInsights }) {
  const posts = block.posts.slice(0, RECENT_POSTS);
  const meta = isMetaPlatform(block.platform);
  /* Lifetime counts the platform publishes, shown only when it did: Facebook
     Pages and Threads have no following or like total, and a dash there would
     read as a number we failed to fetch. Instagram publishes following and
     posts, so those stay on screen even when Meta withheld them. */
  const lifetime: Array<[string, number | null]> = (
    [
      ["Following", block.following, block.platform === "INSTAGRAM"],
      ["Total likes", block.totalLikes, false],
      [MEDIA_LABEL[block.platform], block.mediaCount, block.platform === "INSTAGRAM"],
    ] as Array<[string, number | null, boolean]>
  )
    .filter(([, value, published]) => published || typeof value === "number")
    .map(([label, value]) => [label, value]);
  const figures: Array<[string, number | null]> = [
    ["Followers", block.followers],
    ...lifetime,
    [`Median views, last ${block.sampleSize}`, block.medianViews],
    ["Best post views", block.bestPost?.views ?? null],
    ...(block.platform === "INSTAGRAM"
      ? ([[`Median reach, last ${block.sampleSize}`, block.medianReach]] as Array<[string, number | null]>)
      : []),
  ];
  const withheld = meta && figures.some(([, value]) => value === null);
  return (
    <Card>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <ProfileHeader block={block} />
        {block.needsReconnect && <StatusPill tone="warning">Reconnect needed</StatusPill>}
      </div>
      {block.bio?.trim() && (
        <p style={{ fontSize: 13, color: "var(--cc-text)", margin: "10px 0 0", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{block.bio.trim()}</p>
      )}

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
            {figures.map(([label, value]) => (
              <Figure key={label} label={label} value={value} meta={meta} />
            ))}
          </div>
          {withheld && (
            <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "8px 0 0" }}>{META_MINIMUM_SIZE_NOTE}.</p>
          )}
          {posts.length > 0 ? (
            <>
              <h3 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "16px 0 0" }}>Recent posts</h3>
              <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {posts.map((p) => (
                  <PostLine key={p.id} post={p} />
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
