"use client";

import { useEffect, useMemo, useState } from "react";
import { ImageOff, Eye, Heart, MessageCircle, Share2, Bookmark, Download, Activity } from "lucide-react";
import type { SharedReportData } from "@/lib/reports/campaignPerformance";
import { shareImgSrc } from "@/lib/postMedia";
import { stripAt, formatDateAbs, timeAgo, platformLabel } from "@/lib/format";
import { creatorNameParts, creatorNameText } from "@/lib/creators/creatorName";
import RemovedPostOverlay from "@/components/posts/RemovedPostOverlay";
import PostStatusChip from "@/components/posts/PostStatusChip";
import { UNKNOWN_CREATOR_LABEL, unknownCreatorReason } from "@/lib/posts/unattributedName";

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

/* Below this many posts the whole list fits on a screen or two and the tools
   would be more to read than the list. */
const TOOLS_FROM = 10;
const PAGE_SIZE = { grid: 25, table: 50 } as const;

type SortKey = "views" | "likes" | "engagement" | "newest" | "oldest";
const SORTS: { key: SortKey; label: string }[] = [
  { key: "views", label: "Most views" },
  { key: "likes", label: "Most likes" },
  { key: "engagement", label: "Highest engagement" },
  { key: "newest", label: "Newest" },
  { key: "oldest", label: "Oldest" },
];

/** Unknown sinks to the bottom in every direction: "Most likes" must not open on posts nobody read. */
function sortRows(rows: Row[], key: SortKey): Row[] {
  const val = (r: Row): number | null => {
    switch (key) {
      case "views": return r.views;
      case "likes": return r.likes;
      case "engagement": return r.engagementRate;
      case "newest":
      case "oldest": return new Date(r.postedAt).getTime() || null;
    }
  };
  const dir = key === "oldest" ? 1 : -1;
  return rows
    .map((r, i) => [val(r), i, r] as const)
    .sort((a, b) => {
      if (a[0] === null || b[0] === null) return a[0] === null ? (b[0] === null ? a[1] - b[1] : 1) : -1;
      return (a[0] - b[0]) * dir || a[1] - b[1];
    })
    .map(([, , r]) => r);
}

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
  /* Clipster's report lets a brand find its own post among hundreds; the grid
     alone made that a scroll. Search, platform, sort, a table for scanning
     numbers, and pages -- all on the rows already in the payload, so a hidden-
     creator link searches captions only and never learns a name. */
  const [query, setQuery] = useState("");
  const [platform, setPlatform] = useState("ALL");
  const [sort, setSort] = useState<SortKey>("views");
  const [view, setView] = useState<"grid" | "table">("grid");
  const [page, setPage] = useState(1);

  const platforms = useMemo(() => [...new Set(posts.map((p) => p.platform))].sort(), [posts]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = posts.filter((p) => {
      if (platform !== "ALL" && p.platform !== platform) return false;
      if (!q) return true;
      const hay = [p.caption ?? "", showCreators && p.creator ? `${p.creator.name} ${p.creator.handle ?? ""}` : ""].join(" ").toLowerCase();
      return hay.includes(q);
    });
    return sortRows(rows, sort);
  }, [posts, platform, query, sort, showCreators]);

  if (posts.length === 0) return null;

  const tools = posts.length >= TOOLS_FROM;
  const size = PAGE_SIZE[view];
  const pages = Math.max(1, Math.ceil(visible.length / size));
  const current = Math.min(page, pages);
  const rows = tools ? visible.slice((current - 1) * size, current * size) : posts;
  const from = visible.length === 0 ? 0 : (current - 1) * size + 1;
  const to = Math.min(current * size, visible.length);

  return (
    <>
    {tools && (
      <div className="spr-posttools" data-testid="share-post-tools">
        <input
          type="search"
          className="spr-posttools-search"
          placeholder={showCreators ? "Search creator or caption" : "Search captions"}
          aria-label={showCreators ? "Search posts by creator or caption" : "Search posts by caption"}
          value={query}
          onChange={(e) => { setQuery(e.target.value); setPage(1); }}
        />
        {platforms.length > 1 && (
          <select className="spr-posttools-select" aria-label="Platform" value={platform} onChange={(e) => { setPlatform(e.target.value); setPage(1); }}>
            <option value="ALL">All platforms</option>
            {platforms.map((p) => <option key={p} value={p}>{platformLabel(p)}</option>)}
          </select>
        )}
        <select className="spr-posttools-select" aria-label="Sort posts" value={sort} onChange={(e) => { setSort(e.target.value as SortKey); setPage(1); }}>
          {SORTS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
        <div className="spr-audio-toggle spr-posttools-view" role="group" aria-label="Post layout">
          {(["grid", "table"] as const).map((v) => (
            <button key={v} type="button" className={`spr-audio-tab${view === v ? " is-on" : ""}`} aria-pressed={view === v} onClick={() => { setView(v); setPage(1); }}>
              {v === "grid" ? "Cards" : "Table"}
            </button>
          ))}
        </div>
        <span className="spr-posttools-count" aria-live="polite">
          {visible.length === 0 ? "No posts match" : `${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")} of ${visible.length.toLocaleString("en-US")}`}
        </span>
      </div>
    )}
    {tools && view === "table" ? (
      <SharedPostTable rows={rows} showCreators={showCreators} />
    ) : (
    <div className="spr-posts">
      {rows.map((post) => {
        // 478 = the reference card's 239px track at 2x, so a retina screen gets
        // a sharp thumbnail rather than an upscaled 160.
        const thumb = shareImgSrc(token, post.thumbnailUrl, 478, 490);
        const who = showCreators && post.creator ? creatorNameParts(post.creator.name, post.creator.handle) : null;
        const shown = METRICS.map((m) => ({ ...m, value: post[m.key] as number | null })).filter(
          (m) => m.value !== null
        );
        /* A post nobody could attribute arrives with no creator at all, rather
           than as the holding row's name, which is our filing label and was
           being printed here as if it were a person. */
        const unknownCreator = showCreators && post.unattributed === true;
        const label = who && post.creator
          ? creatorNameText(post.creator.name, post.creator.handle)
          : unknownCreator
            ? UNKNOWN_CREATOR_LABEL
            : platformLabel(post.platform);
        const shownLabel = who ? (
          <>
            <span className="spr-post-name">{who.name}</span>
            {who.handle && <span className="spr-post-at"> {who.handle}</span>}
          </>
        ) : unknownCreator ? (
          <span className="spr-post-name">{UNKNOWN_CREATOR_LABEL}</span>
        ) : (
          platformLabel(post.platform)
        );

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
                  /* Catches an error that fired before hydration attached
                     onError, which otherwise left the browser's broken glyph. */
                  ref={(img) => {
                    if (img?.complete && img.naturalWidth === 0) setBroken((prev) => new Set(prev).add(post.id));
                  }}
                />
              ) : (
                <ImageOff size={22} aria-hidden="true" />
              )}
            </div>

            <div className="spr-post-body">
              {/* No link on a hidden-creator report: the post URL carries the
                  handle in its path, so it is redacted server-side and there
                  is nothing to point at.

                  spr-post-hit stretches this one anchor over the whole card, so
                  the thumbnail and every counter open the post too. Wrapping the
                  card in a link would do the same for the mouse and cost the
                  keyboard: the link's accessible name becomes every metric on
                  the card read out in one breath. This way the card has one tab
                  stop still named "@handle". */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                {showCreators && post.creator?.id && (
                  <SharedCreatorAvatar token={token} creatorId={post.creator.id} avatarUrl={post.creator.avatarUrl ?? null} />
                )}
              {post.postUrl ? (
                <a
                  className="spr-post-handle spr-post-hit"
                  href={post.postUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={label}
                  aria-label={label}
                >
                  {shownLabel}
                </a>
              ) : (
                <span className="spr-post-handle" title={label}>
                  {shownLabel}
                </span>
              )}
              </div>

              {/* Only ever true on a link whose owner turned "Flag removed
                  posts" on -- redactForShare flattens it to false otherwise,
                  so an unmarked link carries no removal in its payload at all. */}
              {post.removed && (
                <span style={{ marginBottom: 4 }}>
                  {/* The resolver's wording when the payload carries it
                      ("Hidden", "Deleted", "Unverified since …"); the plain
                      removed pill for a payload cached before it did. */}
                  {post.status ? (
                    <PostStatusChip status={post.status} compact />
                  ) : (
                    <RemovedPostOverlay variant="inline" compact />
                  )}
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
                {/* Nothing else on the card says where the post is, and a
                    campaign's posts run across TikTok, Instagram and YouTube. */}
                <span>{platformLabel(post.platform)} · Posted {formatDateAbs(post.postedAt)}</span>
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
                  {post.lastSyncedAt
                    ? `Last updated ${timeAgo(post.lastSyncedAt)}`
                    : post.unattributed
                      ? unknownCreatorReason(post.platform)
                      : "Not yet updated"}
                </span>
              </div>
            </div>
          </article>
        );
      })}
    </div>
    )}
    {tools && pages > 1 && (
      <nav className="spr-posttools-pages" aria-label="Post pages">
        <button type="button" className="spr-audio-tab" disabled={current <= 1} onClick={() => setPage(current - 1)}>Previous</button>
        <span>Page {current} of {pages}</span>
        <button type="button" className="spr-audio-tab" disabled={current >= pages} onClick={() => setPage(current + 1)}>Next</button>
      </nav>
    )}
    </>
  );
}

/* The same rows as the cards, one line each, for reading numbers down a
   column. Unknown is a dash, as on the cards it is an absent line. */
function SharedPostTable({ rows, showCreators }: { rows: Row[]; showCreators: boolean }) {
  const cell = (v: number | null) => (v === null ? "\u2014" : v.toLocaleString("en-US"));
  return (
    <div className="spr-posttable-wrap">
      <table className="spr-posttable">
        <thead>
          <tr>
            <th scope="col">{showCreators ? "Creator" : "Post"}</th>
            <th scope="col">Platform</th>
            <th scope="col">Posted</th>
            <th scope="col" className="num">Views</th>
            <th scope="col" className="num">Likes</th>
            <th scope="col" className="num">Comments</th>
            <th scope="col" className="num">Shares</th>
            <th scope="col" className="num">Eng. rate</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const name = showCreators && p.creator
              ? creatorNameText(p.creator.name, p.creator.handle)
              : showCreators && p.unattributed
                ? UNKNOWN_CREATOR_LABEL
                : (p.caption?.slice(0, 48) || platformLabel(p.platform));
            return (
              <tr key={p.id}>
                <td className="name">
                  {p.postUrl ? <a href={p.postUrl} target="_blank" rel="noopener noreferrer">{name}</a> : name}
                  {p.removed && p.status ? <span className="spr-posttable-status"> · {p.status.label}</span> : null}
                </td>
                <td>{platformLabel(p.platform)}</td>
                <td>{formatDateAbs(p.postedAt)}</td>
                <td className="num">{cell(p.views)}</td>
                <td className="num">{cell(p.likes)}</td>
                <td className="num">{cell(p.comments)}</td>
                <td className="num">{cell(p.shares)}</td>
                <td className="num">{p.engagementRate === null ? "\u2014" : `${(p.engagementRate * 100).toFixed(2)}%`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* A 20px picture beside the handle: the stored copy first, the creator's own
   CDN link through the share proxy second, and nothing at all after that --
   the handle beside it already names the creator. */
function SharedCreatorAvatar({ token, creatorId, avatarUrl }: { token: string; creatorId: string; avatarUrl: string | null }) {
  const [miss, setMiss] = useState(0);
  /* Not rendered server-side: a 404 there arrives before onError is attached. */
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (!hydrated) return null;
  const sources = [
    `/api/share/${encodeURIComponent(token)}/avatar/${encodeURIComponent(creatorId)}?w=64`,
    shareImgSrc(token, avatarUrl, 64),
  ].filter((u): u is string => Boolean(u));
  const src = sources[miss];
  if (!src) return null;
  return (
    <img
      key={miss}
      src={src}
      alt=""
      aria-hidden="true"
      loading="lazy"
      onError={() => setMiss((m) => m + 1)}
      style={{ width: 20, height: 20, borderRadius: "50%", objectFit: "cover", flexShrink: 0, marginBottom: 4 }}
    />
  );
}
