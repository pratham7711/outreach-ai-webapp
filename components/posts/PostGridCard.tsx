"use client";

import { memo, type ReactNode } from "react";
import Link from "next/link";
import { Badge } from "@pratham7711/ui";
import { Eye, Heart, MessageCircle, TrendingUp, BarChart3, Share2, Bookmark } from "lucide-react";
import { formatDateAbs, formatFull } from "@/lib/format";
import { metricValue, fieldMetricValue, engagementRateValue } from "@/lib/metricDisplay";
import { isPostRemoved, removedNote } from "@/lib/postRemoval";
import RemovedPostOverlay from "@/components/posts/RemovedPostOverlay";
import PostCover from "@/components/posts/PostCover";
import { STATUS_BADGE, formatSince, engRatePct } from "@/lib/posts/postDisplay";
import type { ComplianceFlag } from "@/lib/compliance/postCompliance";

/**
 * One post tile in the campaign grid.
 *
 * Lifted out of PostsTab and memoised, which is the whole point of it being a
 * component at all. The grid draws 25 of these and the tab above it holds
 * twenty-odd pieces of state -- a sync in flight, a refresh ticking its
 * progress, a modal opening, every keystroke in the creator filter -- and each
 * of those re-rendered all 25 tiles, roughly 60 elements apiece, none of which
 * had changed. Nothing here depends on that state: a tile is a pure function of
 * its post and the campaign id, so React can skip it by reference.
 *
 * Keep it that way. A callback prop added without useCallback, or an object
 * literal passed as a prop, defeats memo silently -- the component still
 * renders correctly and simply stops being skipped. __tests__/unit/
 * postGridCard.render.test.tsx is what notices.
 */

export type PostCardPost = {
  id: string;
  platform: string;
  postUrl: string;
  thumbnailUrl: string | null;
  caption: string | null;
  postedAt: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  platformMetrics?: unknown;
  status: string;
  fetchState: string | null;
  lastSyncedAt: string | null;
  complianceFlags?: ComplianceFlag[];
  creator: { name: string; handle: string };
};

function formatNumber(num: number): string {
  return formatFull(num);
}

function PostGridCardImpl({ post, campaignId }: { post: PostCardPost; campaignId: string }) {
  const cardViews = metricValue(post.viewsCount, post.lastSyncedAt);
  const cardLikes = fieldMetricValue(post.likesCount, post.lastSyncedAt, post.platformMetrics, "likes");
  const cardComments = fieldMetricValue(post.commentsCount, post.lastSyncedAt, post.platformMetrics, "comments");
  const cardShares = fieldMetricValue(post.sharesCount, post.lastSyncedAt, post.platformMetrics, "shares");
  const cardSaves = fieldMetricValue(post.savesCount, post.lastSyncedAt, post.platformMetrics, "saves");
  const cardEngRate =
    cardLikes === null && cardComments === null
      ? null
      : engagementRateValue(
          post.likesCount,
          post.commentsCount,
          post.viewsCount,
          post.lastSyncedAt
        ) ?? engRatePct(post);
  return (
    <div style={{ position: "relative" }}>
    <a
      href={post.postUrl}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        position: "relative",
        display: "block",
        aspectRatio: "9 / 16",
        borderRadius: 20,
        overflow: "hidden",
        textDecoration: "none",
        border: "1px solid var(--cc-border)",
        background: "var(--cc-bg)",
      }}
    >
      {/* Through the proxy, not straight at the CDN: TikTok's
          thumbnail hosts are unreachable on networks that filter
          them. An <img> rather than the background-image this used
          to be, because only the element reports a failed fetch --
          see PostCover for what that was costing. */}
      <PostCover thumbnailUrl={post.thumbnailUrl} width={320} height={568} alt={post.caption} />
      <span style={{ position: "absolute", top: 10, left: 10, padding: "3px 9px", borderRadius: 999, background: "rgba(0,0,0,0.55)", color: "white", fontSize: "var(--cc-t-10)", fontWeight: 700, letterSpacing: 0.4, backdropFilter: "blur(4px)" }}>
        {post.platform}
      </span>
      <span style={{ position: "absolute", top: 10, right: 10 }}>
        <Badge variant={STATUS_BADGE[post.status] ?? "neutral"} style={{ fontSize: "var(--cc-t-9)"}}>
          {post.status.replace(/_/g, " ")}
        </Badge>
      </span>
      {/* Across the frame, under the platform and status chips —
          the thumbnail and every count below it are left alone,
          because they are the last true reading of a post that has
          since come down, not a claim that it is still up. */}
      {isPostRemoved(post) && <RemovedPostOverlay note={removedNote(post)} />}

      {/* Metrics read out over the frame itself — display only, never editable. */}
      <div
        style={{
          position: "absolute",
          insetInline: 0,
          bottom: 0,
          padding: "48px 14px 10px",
          // Fades in over the frame, then goes fully solid behind the
          // counts — the same treatment CreatorCore uses, so numbers
          // never fight the artwork.
          //
          // Every stop is the overlay ink, which is theme-independent
          // on purpose: the thumbnail behind it does not restyle with
          // the theme, and the solid end used to be --cc-text, which
          // is #FFFFFF under .dark -- white counts on a white panel.
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--cc-overlay-ink) 0%, transparent) 0%, color-mix(in srgb, var(--cc-overlay-ink) 72%, transparent) 30%, var(--cc-overlay-ink) 48%, var(--cc-overlay-ink) 100%)",
          color: "var(--cc-overlay-ink-text)",
        }}
      >
        <div title={post.creator.name} style={{ fontSize: "var(--cc-t-14)", fontWeight: 700, marginBottom: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {post.creator.handle || post.creator.name}
        </div>
        {/* One row per counter the platform actually reported, which is
            how the reference card behaves too: it prints a downloads
            line on most posts and simply leaves it off the ones it has
            no download figure for. Shares and saves used to be held
            back from here because an unfetched counter sat at 0 in the
            column and would have read as a measured zero -- per-field
            provenance answers that now, so they can be shown. */}
{(() => {
          const rows = [
            cardViews !== null && { key: "views", icon: <Eye size={13} aria-hidden="true" />, text: `${formatNumber(cardViews)} views` },
            cardLikes !== null && { key: "likes", icon: <Heart size={13} aria-hidden="true" />, text: `${formatNumber(cardLikes)} likes` },
            cardComments !== null && { key: "comments", icon: <MessageCircle size={13} aria-hidden="true" />, text: `${formatNumber(cardComments)} comments` },
            cardShares !== null && { key: "shares", icon: <Share2 size={13} aria-hidden="true" />, text: `${formatNumber(cardShares)} shares` },
            cardSaves !== null && { key: "saves", icon: <Bookmark size={13} aria-hidden="true" />, text: `${formatNumber(cardSaves)} saves` },
            cardEngRate !== null && { key: "eng", icon: <TrendingUp size={13} aria-hidden="true" />, text: `${cardEngRate.toFixed(1)}% eng. rate` },
          ].filter(Boolean) as { key: string; icon: ReactNode; text: string }[];
          // Nothing measured at all: say so once. Four zeroes claim
          // this post was watched by nobody, which we never checked.
          if (rows.length === 0) {
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--cc-t-13)", color: "rgba(255,255,255,0.72)" }}>
                <Eye size={13} aria-hidden="true" />Not synced yet
              </div>
            );
          }
          return rows.map((row) => (
            <div key={row.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--cc-t-13)", marginBottom: 2 }}>
              {row.icon}{row.text}
            </div>
          ));
        })()}
        {/* paddingRight clears the analytics link, which is pinned
            12px off the card's right edge and 14px wide -- inside
            this row's own 14px padding, so "Updated 1mo ago" was
            printing straight through the chart icon. The reserve is
            that 26px back to this box's edge, plus a 6px gap. */}
        <div style={{ marginTop: 8, paddingTop: 7, paddingRight: 18, borderTop: "1px solid rgba(255,255,255,0.22)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 10.5, color: "rgba(255,255,255,0.78)" }}>
          {/* Only once a platform has answered for this post: until
              then postedAt is the day someone added it here, not the
              day it went up, and Post.postedAt cannot be null. */}
          <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            Posted {post.lastSyncedAt ? formatDateAbs(post.postedAt) : "\u2014"}
          </span>
          {/* "Updated", where the reference says "Last Updated": the
              long form plus a "3 months ago" overflows a 240px card.
              It never shrinks -- a clipped "Updated 1mo a…" is worse
              than a clipped date, which the reader can still date by
              its month. */}
          <span style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
            Updated {formatSince(post.lastSyncedAt)}
          </span>
        </div>
      </div>
    </a>
    {/* Sits over the tile's solid footer rather than inside the
        anchor -- an <a> cannot nest. */}
    <Link href={`/campaigns/${campaignId}/posts/${post.id}`} aria-label="View post analytics" title="View post analytics" style={{ position: "absolute", right: 12, bottom: 10, display: "flex", alignItems: "center", color: "rgba(255,255,255,0.78)", textDecoration: "none" }}>
      <BarChart3 size={14} />
    </Link>
    </div>
  );
}

export default memo(PostGridCardImpl);
