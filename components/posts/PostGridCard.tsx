"use client";

import { memo, type ReactNode } from "react";
import { StatusBadge } from "@/components/ds/StatusBadge";
import { Eye, Heart, MessageCircle, TrendingUp, Share2, Bookmark, Check, AlertTriangle } from "lucide-react";
import { formatDateAbs, formatFull, platformLabel } from "@/lib/format";
import { fieldMetricValue, unwrittenMetricValue, sharesUnknownReason } from "@/lib/metricDisplay";
import { postAgeContext, postMeasuredAt, postStatus } from "@/lib/posts/postStatus";
import { viewsAsOf } from "@/lib/posts/fieldFreshness";
import PostStatusChip from "@/components/posts/PostStatusChip";
import { AgeLabel } from "@/components/ds/AgeLabel";
import PostCover from "@/components/posts/PostCover";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import { engRatePct, trackingLabel } from "@/lib/posts/postDisplay";
import type { ComplianceFlag } from "@/lib/compliance/postCompliance";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import CreatorName from "@/components/creators/CreatorName";
import { creatorNameText } from "@/lib/creators/creatorName";
import { UNKNOWN_CREATOR_LABEL, isUnattributedCreator } from "@/lib/posts/unattributedName";
import { isPostNotPublic, mayBeAgeLimited } from "@/lib/postRemoval";
import UnknownCreator from "@/components/posts/UnknownCreator";
import { PostAnnotationChips } from "@/components/posts/PostAnnotationChips";
import type { PostAnnotationView } from "@/lib/posts/annotations";

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
  /** CreatorCore's last refresh, for an imported post we have not read. */
  lastFreshAt?: string | null;
  /** When views were last read (lib/posts/fieldFreshness). */
  viewsReadAt?: string | null;
  trackingEnabled?: boolean;
  trackingExpiresAt?: string | null;
  trackingSource?: string | null;
  complianceFlags?: ComplianceFlag[];
  /** An unreviewed view check (lib/fraud/scanPosts). */
  hasOpenFraudFlag?: boolean;
  creator: { id?: string; name: string; handle: string };
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
  showShares = false,
  onCheckViews,
  annotation,
  removed = false,
  nowMs = 0,
}: {
  post: PostCardPost;
  selected: boolean;
  /** Something on this page is selected -- not necessarily this tile. Keeps
   *  every pick visible while a selection is being built. */
  selectionActive: boolean;
  onToggleSelect: (postId: string) => void;
  onOpenMenu: (postId: string, x: number, y: number) => void;
  /** Some post in this list has a share count, so a card without one says
   *  why rather than dropping the line -- otherwise the grid reads as some
   *  cards missing a field the others have. */
  showShares?: boolean;
  /** Opens the view-check dialog. Must be stable (useCallback) -- see above. */
  onCheckViews?: (postId: string) => void;
  /** Boost code, rule notes, exclusion reason (lib/posts/annotations). */
  annotation?: PostAnnotationView;
  /** The tab is showing Removed posts, where the exclusion reason belongs. */
  removed?: boolean;
  /** When the tab loaded, for the boost code's expiry. */
  nowMs?: number;
}) {
  const unknownCreator = isUnattributedCreator(post.creator);
  const tracking = post.trackingEnabled === true;
  const status = postStatus(post);
  const measured = postMeasuredAt(post);
  const cardViews = fieldMetricValue(post.viewsCount, post.lastSyncedAt, post.platformMetrics, "views");
  /* "Updated" below is the latest read. When that read did not return views,
     the views line carries its own date. */
  const viewsNote = cardViews === null ? null : viewsAsOf(post);
  const cardLikes = fieldMetricValue(post.likesCount, post.lastSyncedAt, post.platformMetrics, "likes");
  const cardComments = fieldMetricValue(post.commentsCount, post.lastSyncedAt, post.platformMetrics, "comments");
  const cardShares = fieldMetricValue(post.sharesCount, post.lastSyncedAt, post.platformMetrics, "shares", post.platform);
  /* The list view's gate, so the two views agree: no reader stores saves for
     posts we do not own, and the 0 an unfetched row holds printed "0 saves". */
  const cardSaves = unwrittenMetricValue(post.savesCount);
  /* The product's one per-post rate, as the list, the post page, the share
     link and the exports print it. This card used to show (likes + comments)
     / views to one place -- 8.6% beside the post page's 9.91%. */
  const cardEngRate = engRatePct(post);
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
      {/* One row, not two absolute corners: at five columns (232px tiles at
          1440) the two corners overlapped by up to 17px. See
          .cc-posttile-chips for how the row gives way when it is short. */}
      <span className="cc-posttile-chips">
        <span className="cc-posttile-platform" title={platformLabel(post.platform)}>
          <PlatformGlyph platform={post.platform} size="1.2em" />
          <span className="cc-posttile-platform-name" aria-hidden="true">{platformLabel(post.platform)}</span>
        </span>
        {/* On an opaque card ground: a tinted chip over artwork was 9px
            green on translucent green, unreadable on a busy thumbnail. */}
        <StatusBadge status={post.status} className="cc-posttile-status" />
      </span>
      {/* Across the frame, under the platform and status chips —
          the thumbnail and every count below it are left alone,
          because they are the last true reading of a post that has
          since come down, not a claim that it is still up. */}
      <PostStatusChip status={status} variant="overlay" />

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
          // is white under .dark -- white counts on a white panel.
          background:
            "linear-gradient(to bottom, color-mix(in srgb, var(--cc-overlay-ink) 0%, transparent) 0%, color-mix(in srgb, var(--cc-overlay-ink) 72%, transparent) 30%, var(--cc-overlay-ink) 48%, var(--cc-overlay-ink) 100%)",
          color: "var(--cc-overlay-ink-text)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6, minWidth: 0 }}>
          {unknownCreator ? (
            <UnknownCreator
              platform={post.platform}
              tone="overlay"
              notPublic={isPostNotPublic(post)}
              ageLimitPossible={mayBeAgeLimited(post)}
            />
          ) : (
            <>
              <CreatorAvatar id={post.creator.id} name={post.creator.name} size="sm" />
              <CreatorName name={post.creator.name} handle={post.creator.handle} tone="overlay" />
            </>
          )}
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
            cardViews !== null && {
              key: "views",
              icon: <Eye size={13} aria-hidden="true" />,
              text: `${formatNumber(cardViews)} views`,
              ...(viewsNote ? { note: viewsNote.short, title: viewsNote.title } : {}),
            },
            cardLikes !== null && { key: "likes", icon: <Heart size={13} aria-hidden="true" />, text: `${formatNumber(cardLikes)} likes` },
            cardComments !== null && { key: "comments", icon: <MessageCircle size={13} aria-hidden="true" />, text: `${formatNumber(cardComments)} comments` },
            cardShares !== null
              ? { key: "shares", icon: <Share2 size={13} aria-hidden="true" />, text: `${formatNumber(cardShares)} shares` }
              : showShares && {
                  key: "shares",
                  icon: <Share2 size={13} aria-hidden="true" />,
                  text: "\u2014 shares",
                  title: sharesUnknownReason(post.platform).title,
                  unknown: true,
                },
            cardSaves !== null && { key: "saves", icon: <Bookmark size={13} aria-hidden="true" />, text: `${formatNumber(cardSaves)} saves` },
            cardEngRate !== null && { key: "eng", icon: <TrendingUp size={13} aria-hidden="true" />, text: `${cardEngRate.toFixed(2)}% eng. rate` },
          ].filter(Boolean) as { key: string; icon: ReactNode; text: string; note?: string; title?: string; unknown?: boolean }[];
          // Nothing measured at all: say so once. Four zeroes claim
          // this post was watched by nobody, which we never checked.
          if (rows.every((row) => row.unknown)) {
            return (
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--cc-t-13)", color: "color-mix(in srgb, var(--cc-overlay-ink-text) 72%, transparent)" }}>
                <Eye size={13} aria-hidden="true" />Not synced yet
              </div>
            );
          }
          return rows.map((row) => (
            <div key={row.key} className="cc-posttile-stat" data-stat={row.key} title={row.title} style={{ fontSize: "var(--cc-t-13)", marginBottom: 2, minWidth: 0 }}>
              {row.icon}{row.text}
              {row.note && (
                <span style={{ fontSize: "var(--cc-t-11)", color: "color-mix(in srgb, var(--cc-overlay-ink-text) 72%, transparent)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  · {row.note}
                </span>
              )}
            </div>
          ));
        })()}
        {/* No paddingRight any more: the corner icons this row used to clear
            are gone, so the date line gets the tile's full width back. */}
        <div className="cc-posttile-foot" style={{ marginTop: 8, paddingTop: 7, borderTop: "1px solid color-mix(in srgb, var(--cc-overlay-ink-text) 22%, transparent)", fontSize: 12, color: "color-mix(in srgb, var(--cc-overlay-ink-text) 78%, transparent)" }}>
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
                title={trackingLabel(true, post.trackingExpiresAt ?? null, post.trackingSource)}
                style={{ width: 6, height: 6, borderRadius: 999, background: "var(--cc-primary)", boxShadow: "0 0 0 2px color-mix(in srgb, var(--cc-overlay-ink-text) 28%, transparent)", flexShrink: 0 }}
              />
            )}
            {/* The counters' age; a Stale chip joins it once a tracked post
                has missed two reads (lib/dataAge). Inherits the overlay ink. */}
            <AgeLabel
              at={measured.at}
              field="post"
              ctx={postAgeContext(post, status)}
              source={measured.source}
              prefix="Updated"
              never="Never updated"
              style={{ color: "inherit", fontSize: "inherit" }}
            />
          </span>
        </div>
      </div>
    </a>
    {/* Outside the anchor for the same reason as the pick below: a button
        inside a link would open the platform post. Under the chips row, on
        the left, where the status overlay does not reach. */}
    {post.hasOpenFraudFlag && onCheckViews && (
      <button
        type="button"
        className="cc-viewcheck-chip cc-viewcheck-chip--tile"
        onClick={() => onCheckViews(post.id)}
        title="Why this post was flagged, and how to clear it"
      >
        <AlertTriangle size={12} aria-hidden="true" /> Check views
      </button>
    )}
    {/* Under the artwork, outside the anchor: the copy button must not open
        the platform post. */}
    <PostAnnotationChips annotation={annotation} removed={removed} nowMs={nowMs} tile />
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
        aria-label={`Select post by ${unknownCreator ? UNKNOWN_CREATOR_LABEL.toLowerCase() : creatorNameText(post.creator.name, post.creator.handle)}`}
      />
      <span className="cc-postpick-box" aria-hidden="true">
        <Check size={13} strokeWidth={3} />
      </span>
    </label>

    </div>
  );
}

export default memo(PostGridCardImpl);
