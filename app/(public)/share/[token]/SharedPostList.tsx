"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";
import type { SharedReportData } from "@/lib/reports/campaignPerformance";
import { shareImgSrc } from "@/lib/postMedia";
import { stripAt, formatDateAbs, timeAgo } from "@/lib/format";

/**
 * The post list on a shared client report.
 *
 * This is what a brand actually reads. CreatorCore's report lists every post on
 * the campaign with its own counters; ours listed a ten-row creator leaderboard
 * and stopped, so a seventeen-post campaign showed ten rows and no per-post
 * numbers at all. The leaderboard stays above this -- it answers "who delivered
 * the most" -- but it is a summary of this list, not a replacement for it.
 *
 * Every counter is nullable and a null is simply absent from the card. That is
 * not a stylistic choice: TikTok's public payload carries views, likes, comments
 * and shares but never saves or downloads, so printing a 0 would tell a brand a
 * post earned no saves when the truth is nobody ever asked. CreatorCore does the
 * same thing on its own cards -- one post there shows views and comments and no
 * likes -- so omitting an unknown is parity, not divergence.
 */

type Row = SharedReportData["posts"][number];

const labelStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "var(--cc-text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const METRICS: { key: keyof Row; label: string }[] = [
  { key: "views", label: "views" },
  { key: "likes", label: "likes" },
  { key: "comments", label: "comments" },
  { key: "shares", label: "shares" },
  { key: "saves", label: "saves" },
  { key: "downloads", label: "downloads" },
];

export default function SharedPostList({
  posts,
  token,
  showCreators,
}: {
  posts: Row[];
  token: string;
  showCreators: boolean;
}) {
  // A thumbnail that fails to load leaves a blank rectangle with no way back, so
  // the failures are tracked and the card falls through to the placeholder.
  const [broken, setBroken] = useState<Set<string>>(new Set());

  if (posts.length === 0) return null;

  return (
    <div
      style={{
        background: "var(--cc-card)",
        border: "1px solid var(--cc-border)",
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          padding: "16px 24px",
          borderBottom: "1px solid var(--cc-border)",
          display: "flex",
          alignItems: "baseline",
          gap: 8,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>Posts</span>
        <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{posts.length}</span>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 16,
          padding: 20,
        }}
      >
        {posts.map((post) => {
          const thumb = shareImgSrc(token, post.thumbnailUrl, 160, 214);
          const handle = post.creator?.handle ? `@${stripAt(post.creator.handle)}` : null;
          const shown = METRICS.map((m) => ({ ...m, value: post[m.key] as number | null })).filter(
            (m) => m.value !== null
          );

          return (
            <div
              key={post.id}
              style={{
                display: "flex",
                gap: 14,
                padding: 14,
                border: "1px solid var(--cc-border)",
                borderRadius: 12,
                background: "var(--cc-bg)",
                minWidth: 0,
              }}
            >
              <div
                style={{
                  width: 80,
                  height: 107,
                  flexShrink: 0,
                  borderRadius: 8,
                  overflow: "hidden",
                  border: "1px solid var(--cc-border)",
                  background: "var(--cc-card)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "var(--cc-text-subtle)",
                }}
              >
                {thumb && !broken.has(post.id) ? (
                  <img
                    src={thumb}
                    alt={post.caption ? post.caption.slice(0, 60) : "Post thumbnail"}
                    loading="lazy"
                    decoding="async"
                    onError={() => setBroken((prev) => new Set(prev).add(post.id))}
                    style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                  />
                ) : (
                  <ImageOff size={18} aria-hidden="true" />
                )}
              </div>

              <div style={{ minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
                {/* No link on a hidden-creator report: the post URL carries the
                    handle in its path, so it is redacted server-side and there
                    is nothing to point at. */}
                {post.postUrl ? (
                  <a
                    href={post.postUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={showCreators && handle ? handle : undefined}
                    style={{ ...labelStyle, textDecoration: "none" }}
                  >
                    {showCreators && handle ? handle : post.platform}
                  </a>
                ) : (
                  <span style={labelStyle}>{post.platform}</span>
                )}

                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {shown.map((m) => (
                    <span key={m.key as string} style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                      <strong style={{ color: "var(--cc-text)", fontWeight: 600 }}>
                        {/* Full figures with separators, as CreatorCore prints them
                            here: "55,364 views", not "55.4K". */}
                        {m.value!.toLocaleString("en-US")}
                      </strong>{" "}
                      {m.label}
                    </span>
                  ))}
                  {post.engagementRate !== null && (
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                      <strong style={{ color: "var(--cc-text)", fontWeight: 600 }}>
                        {(post.engagementRate * 100).toFixed(2)}%
                      </strong>{" "}
                      eng. rate
                    </span>
                  )}
                </div>

                <div style={{ marginTop: "auto", fontSize: 11, color: "var(--cc-text-subtle)", lineHeight: 1.5 }}>
                  <div>Posted {formatDateAbs(post.postedAt)}</div>
                  {/* "Never" would read as a claim about the post rather than
                      about our own sync, which has simply not run for it.

                      suppressHydrationWarning because this is the one string on
                      the page measured against the clock. The server renders it
                      when the request is served and the browser re-renders it on
                      hydration, so any gap that crosses a minute turns "21m ago"
                      into "22m ago" and React reports a mismatch -- which is
                      what production was throwing while local never did, the
                      gap there being under a second. The client's answer is the
                      correct one; only the complaint is unwanted. */}
                  <div suppressHydrationWarning>
                    {post.lastSyncedAt ? `Last updated ${timeAgo(post.lastSyncedAt)}` : "Not yet updated"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
