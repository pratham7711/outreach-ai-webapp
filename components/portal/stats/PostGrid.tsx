"use client";

import { useId, useState } from "react";
import { Heart, MessageCircle, Play, Share2, Users } from "lucide-react";
import type { InsightsPost, PlatformInsights } from "@/lib/portal/creatorInsights";
import { engagementPerView, timesMedian } from "@/lib/portal/statsMath";
import { PlatformGlyph } from "@/components/ui/PlatformGlyph";
import { formatCount, formatDay, platformLabel, secondaryButtonStyle } from "@/components/portal/app/ui";
import { NUM, Thumb, Toggle, formatPercent, formatTimes, muted } from "@/components/insights/parts";
import PageCommentsPanel from "@/components/portal/stats/PageCommentsPanel";

type Sort = "newest" | "views" | "engagement";

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "newest", label: "Newest" },
  { value: "views", label: "Most viewed" },
  { value: "engagement", label: "Most engaging" },
];

const FIRST_SHOWN = 8;

const byViews = (a: InsightsPost, b: InsightsPost) => (b.views ?? -1) - (a.views ?? -1);
const byEngagement = (a: InsightsPost, b: InsightsPost) => (engagementPerView(b) ?? -1) - (engagementPerView(a) ?? -1);

function Count({ icon: Icon, value, label }: { icon: typeof Heart; value: number | null | undefined; label: string }) {
  if (typeof value !== "number") return null;
  return (
    <span style={{ ...NUM, display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap" }}>
      <Icon size={13} aria-hidden="true" strokeWidth={2} />
      {formatCount(value)}
      <span className="sr-only"> {label}</span>
    </span>
  );
}

/** One post as its cover, with its views on the image and how they compare
    with the account's typical post; the caption and the rest of its counts
    beneath. */
function PostTile({ post, platform, best, times }: { post: InsightsPost; platform: PlatformInsights["platform"]; best: boolean; times: number | null }) {
  const caption = post.caption?.trim() || "Untitled post";
  /* Only a post that clearly beat the typical one carries a multiple; a chip
     on every tile ("1×", "0.7×") would be noise that reads as a grade. */
  const shownTimes = times !== null && times >= 1.2 ? times : null;
  const strong = shownTimes !== null && shownTimes >= 2;
  const cover = (
    <>
      <Thumb
        fill
        radius={0}
        src={post.coverImageUrl}
        fallback={
          <span style={{ fontSize: 28, display: "inline-flex" }}>
            <PlatformGlyph platform={platform} size="1em" />
          </span>
        }
      />
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          background: "linear-gradient(to top, color-mix(in srgb, var(--cc-media-ink) 70%, transparent) 0%, transparent 46%)",
        }}
      />
      {best && (
        <span
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            fontSize: 11,
            fontWeight: 700,
            padding: "3px 8px",
            borderRadius: 999,
            background: "var(--cc-overlay-ink)",
            color: "var(--cc-overlay-ink-text)",
          }}
        >
          Top post
        </span>
      )}
      <span
        style={{
          position: "absolute",
          left: 10,
          right: 10,
          bottom: 9,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          color: "var(--cc-overlay-ink-text)",
        }}
      >
        {typeof post.views === "number" ? (
          <span style={{ ...NUM, display: "inline-flex", alignItems: "center", gap: 4, fontSize: 15, fontWeight: 700 }}>
            <Play size={13} aria-hidden="true" fill="currentColor" strokeWidth={0} />
            {formatCount(post.views)}
            <span className="sr-only"> views</span>
          </span>
        ) : (
          <span />
        )}
        {shownTimes !== null && (
          <span
            title="Views compared with the median of these posts"
            style={{
              ...NUM,
              fontSize: 12,
              fontWeight: 700,
              padding: "2px 7px",
              borderRadius: 999,
              background: strong ? "var(--cc-overlay-ink-text)" : "color-mix(in srgb, var(--cc-overlay-ink-text) 22%, transparent)",
              color: strong ? "var(--cc-media-ink)" : "var(--cc-overlay-ink-text)",
            }}
          >
            {formatTimes(shownTimes)}
            <span className="sr-only"> your median views</span>
          </span>
        )}
      </span>
    </>
  );
  const frame = { position: "relative", display: "block", aspectRatio: "4 / 5", borderRadius: 12, overflow: "hidden", background: "var(--cc-hover-bg)" } as const;

  return (
    <li style={{ minWidth: 0 }}>
      {post.shareUrl ? (
        <a
          href={post.shareUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`${caption}, opens on ${platformLabel(platform)}`}
          className="focus-visible:outline-2 focus-visible:outline-offset-2"
          style={{ ...frame, outlineColor: "var(--cc-primary)" }}
        >
          {cover}
        </a>
      ) : (
        <div style={frame}>{cover}</div>
      )}
      <p
        style={{
          fontSize: 13,
          color: "var(--cc-text)",
          lineHeight: 1.4,
          margin: "8px 0 0",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          overflowWrap: "anywhere",
        }}
      >
        {caption}
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 10px", marginTop: 6, fontSize: 12, color: "var(--cc-text-muted)" }}>
        <span>{formatDay(post.postedAt)}</span>
        <Count icon={Heart} value={post.likes} label="likes" />
        <Count icon={MessageCircle} value={post.comments} label="comments" />
        <Count icon={Share2} value={post.shares} label="shares" />
        <Count icon={Users} value={post.reach} label="accounts reached" />
      </div>
      {platform === "FACEBOOK" && <PageCommentsPanel postId={post.id} />}
    </li>
  );
}

/** The account's recent posts as a wall of covers, newest first, re-sortable
    by views or by engagement per view -- each sort offered only when some post
    carries the figure it sorts by. A count a post did not return is left off
    its tile rather than shown as a dash. */
export default function PostGrid({ block, engagement = null }: { block: PlatformInsights; engagement?: number | null }) {
  const id = useId();
  const [sort, setSort] = useState<Sort>("newest");
  const [all, setAll] = useState(false);
  const posts = block.posts;
  const sorts = SORTS.filter(
    (s) => s.value === "newest" || (s.value === "views" ? posts.some((p) => typeof p.views === "number") : posts.some((p) => engagementPerView(p) !== null)),
  );
  const sorted = sort === "views" ? [...posts].sort(byViews) : sort === "engagement" ? [...posts].sort(byEngagement) : posts;
  const shown = all ? sorted : sorted.slice(0, FIRST_SHOWN);
  const n = block.sampleSize;
  const bestId = block.bestPost?.id ?? null;

  return (
    <section aria-labelledby={id}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px 16px", flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ minWidth: 0 }}>
          <h3 id={id} style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", margin: 0, lineHeight: 1.3 }}>
            Recent posts
          </h3>
          {posts.length > 0 && n > 0 && (
            <p style={{ ...muted, fontSize: 12, marginTop: 2 }}>
              Your last {n} {n === 1 ? "post" : "posts"}
              {typeof block.medianViews === "number" && <> · typical post {formatCount(block.medianViews)} views</>}
              {engagement !== null && <> · {formatPercent(engagement)} engagement per view</>}
            </p>
          )}
        </div>
        {posts.length > 1 && sorts.length > 1 && <Toggle label="Sort posts" options={sorts} value={sort} onChange={setSort} />}
      </div>
      {posts.length === 0 ? (
        <p style={muted}>No recent posts came back from this account.</p>
      ) : (
        <>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 150px), 1fr))",
              gap: "18px 12px",
              alignItems: "start",
            }}
          >
            {shown.map((p) => (
              <PostTile key={p.id} post={p} platform={block.platform} best={p.id === bestId && n > 1} times={timesMedian(p.views, block.medianViews, n)} />
            ))}
          </ul>
          {sorted.length > FIRST_SHOWN && (
            <div style={{ marginTop: 16 }}>
              <button type="button" onClick={() => setAll((v) => !v)} className="rsp-touch" style={{ ...secondaryButtonStyle, minHeight: 32, padding: "6px 12px", fontSize: 13 }}>
                {all ? "Show fewer" : `Show all ${sorted.length}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
