"use client";

import { useState } from "react";
import { ImageOff, Eye, Heart, MessageCircle, Share2, Bookmark, Download, Activity } from "lucide-react";
import type { SharedReportData } from "@/lib/reports/campaignPerformance";
import { shareImgSrc } from "@/lib/postMedia";
import { stripAt, formatDateAbs, timeAgo } from "@/lib/format";
import RemovedPostOverlay from "@/components/posts/RemovedPostOverlay";

/**
 * The post grid on a shared client report.
 *
 * This is what a brand actually reads. The reference client report lists every
 * post on the campaign as a portrait card -- thumbnail on top, then the handle
 * and one line per counter over a black ground -- five across at 1440, two at
 * 768 and one on a phone. The leaderboard above stays a summary of this grid,
 * not a replacement for it.
 *
 * Every counter is nullable and a null is simply absent from the card. That is
 * not a stylistic choice: TikTok's public payload carries views, likes, comments
 * and shares but never saves or downloads, so printing a 0 would tell a brand a
 * post earned no saves when the truth is nobody ever asked. The reference does
 * the same thing on its own cards -- one post there shows views and comments and
 * no likes -- so omitting an unknown is parity, not divergence.
 */

type Row = SharedReportData["posts"][number];

const METRICS: { key: keyof Row; label: string; Icon: typeof Eye }[] = [
  { key: "views", label: "views", Icon: Eye },
  { key: "likes", label: "likes", Icon: Heart },
  { key: "comments", label: "comments", Icon: MessageCircle },
  { key: "shares", label: "shares", Icon: Share2 },
  { key: "saves", label: "saves", Icon: Bookmark },
  { key: "downloads", label: "downloads", Icon: Download },
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
    <div className="spr-posts">
      {posts.map((post) => {
        // 478 = the reference card's 239px track at 2x, so a retina screen gets
        // a sharp thumbnail rather than an upscaled 160.
        const thumb = shareImgSrc(token, post.thumbnailUrl, 478, 490);
        const handle = post.creator?.handle ? `@${stripAt(post.creator.handle)}` : null;
        const shown = METRICS.map((m) => ({ ...m, value: post[m.key] as number | null })).filter(
          (m) => m.value !== null
        );
        const label = showCreators && handle ? handle : post.platform;

        return (
          <article key={post.id} className="spr-post">
            <div className="spr-post-thumb">
              {thumb && !broken.has(post.id) ? (
                <img
                  src={thumb}
                  alt={post.caption ? post.caption.slice(0, 60) : "Post thumbnail"}
                  loading="lazy"
                  decoding="async"
                  onError={() => setBroken((prev) => new Set(prev).add(post.id))}
                />
              ) : (
                <ImageOff size={22} aria-hidden="true" />
              )}
            </div>

            <div className="spr-post-body">
              {/* No link on a hidden-creator report: the post URL carries the
                  handle in its path, so it is redacted server-side and there
                  is nothing to point at. */}
              {post.postUrl ? (
                <a
                  className="spr-post-handle"
                  href={post.postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={label}
                >
                  {label}
                </a>
              ) : (
                <span className="spr-post-handle">{label}</span>
              )}

              {/* Only ever true on a link whose owner turned "Flag removed
                  posts" on -- redactForShare flattens it to false otherwise,
                  so an unmarked link carries no removal in its payload at all. */}
              {post.removed && (
                <span style={{ marginBottom: 4 }}>
                  <RemovedPostOverlay variant="inline" compact />
                </span>
              )}

              {shown.map((m) => (
                <span key={m.key as string} className="spr-post-metric">
                  <m.Icon size={14} aria-hidden="true" />
                  {/* Full figures with separators, as the reference prints them
                      here: "55,364 views", not "55.4K". */}
                  {m.value!.toLocaleString("en-US")} {m.label}
                </span>
              ))}
              {post.engagementRate !== null && (
                <span className="spr-post-metric">
                  <Activity size={14} aria-hidden="true" />
                  {(post.engagementRate * 100).toFixed(2)}% eng. rate
                </span>
              )}

              <div className="spr-post-meta">
                <span>Posted {formatDateAbs(post.postedAt)}</span>
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
                <span suppressHydrationWarning>
                  {post.lastSyncedAt ? `Last updated ${timeAgo(post.lastSyncedAt)}` : "Not yet updated"}
                </span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
