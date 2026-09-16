"use client";

import { memo, type ReactNode } from "react";
import { Badge } from "@pratham7711/ui";
import { Eye, Heart, MessageCircle, TrendingUp, Share2, Bookmark, Check } from "lucide-react";
import { formatDateAbs, formatFull } from "@/lib/format";
import { fieldMetricValue, engagementRateValue } from "@/lib/metricDisplay";
import { isPostRemoved, removedNote } from "@/lib/postRemoval";
import RemovedPostOverlay from "@/components/posts/RemovedPostOverlay";
import PostCover from "@/components/posts/PostCover";
import { STATUS_BADGE, formatSince, engRatePct, trackingLabel } from "@/lib/posts/postDisplay";
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
  trackingEnabled?: boolean;
  trackingExpiresAt?: string | null;
  complianceFlags?: ComplianceFlag[];
  creator: { name: string; handle: string };
};

function formatNumber(num: number): string {
  return formatFull(num);
}

/**
 * Every prop here is a primitive or a stable callback, which is what keeps the
 * memo above meaningful: selecting one tile must not re-render the other
 * twenty-four. `selected` and `trackingBusy` are per-tile booleans, and both
 * handlers are useCallback'd by the tab.
 */
function PostGridCardImpl({
  post,
  selected,
  selectionActive,
  onToggleSelect,
  onOpenMenu,
}: {
  post: PostCardPost;
  selected: boolean;
  /** Something on this page is selected -- not necessarily this tile. Keeps
   *  every pick visible while a selection is being built. */
  selectionActive: boolean;
  onToggleSelect: (postId: string) => void;
  onOpenMenu: (postId: string, x: number, y: number) => void;
}) {
  const tracking = post.trackingEnabled === true;
  const cardViews = fieldMetricValue(post.viewsCount, post.lastSyncedAt, post.platformMetrics, "views");
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
    /* onContextMenu rather than a visible trigger: the corner used to hold two
       icons on every tile, and the actions they opened are worth less than the
       artwork they covered. The menu is opened by the tab, which is the only
       party that knows whether this post is part of a larger selection. */
    <div
      className="cc-posttile"
      style={{ position: "relative" }}
      onContextMenu={(e) => {
        e.preventDefault();
        onOpenMenu(post.id, e.clientX, e.clientY);
      }}
    >
    {/* The ring, not a tint: a selected tile still has to show its artwork
        truthfully, and a wash over the thumbnail changes what the operator is
        judging. 3px because 2 disappears against a busy frame. */}
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        inset: -3,
        borderRadius: 23,
        border: selected ? "3px solid var(--cc-primary)" : "3px solid transparent",
        pointerEvents: "none",
        zIndex: 2,
      }}
    />
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
      <span style={{ position: "absolute", top: 10, left: 42, padding: "3px 9px", borderRadius: 999, background: "rgba(0,0,0,0.55)", color: "white", fontSize: "var(--cc-t-10)", fontWeight: 700, letterSpacing: 0.4, backdropFilter: "blur(4px)" }}>
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
        {/* No paddingRight any more: the corner icons this row used to clear
            are gone, so the date line gets the tile's full width back. */}
        <div style={{ marginTop: 8, paddingTop: 7, borderTop: "1px solid rgba(255,255,255,0.22)", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, fontSize: 10.5, color: "rgba(255,255,255,0.78)" }}>
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
          <span style={{ flexShrink: 0, whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 5 }}>
            {/* State, not a control. Removing the tracking button would
                otherwise make tracking invisible on the grid again, which is
                the thing that was wrong with this screen in the first place. */}
            {tracking && (
              <span
                title={trackingLabel(true, post.trackingExpiresAt ?? null)}
                style={{ width: 6, height: 6, borderRadius: 999, background: "var(--cc-primary)", boxShadow: "0 0 0 2px rgba(255,255,255,0.28)", flexShrink: 0 }}
              />
            )}
            Updated {formatSince(post.lastSyncedAt)}
          </span>
        </div>
      </div>
    </a>
    {/* Selection lives outside the anchor, or every click would open the
        platform post instead of ticking the box. Hidden until the pointer is
        over the tile, the keyboard is inside it, or a selection is already
        running -- see .cc-postpick in globals.css, which is where hover has to
        live. */}
    <label
      className="cc-postpick"
      data-on={selected || selectionActive ? "1" : "0"}
      title={selected ? "Deselect this post" : "Select this post"}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(post.id)}
        aria-label={`Select post by ${post.creator.handle || post.creator.name}`}
      />
      <span className="cc-postpick-box" aria-hidden="true">
        <Check size={13} strokeWidth={3} />
      </span>
    </label>

    </div>
  );
}

export default memo(PostGridCardImpl);
