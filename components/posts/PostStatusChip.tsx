import RemovedPostOverlay from "@/components/posts/RemovedPostOverlay";
import type { PostStatus } from "@/lib/posts/postStatus";

/**
 * A post's status (lib/posts/postStatus) as a chip, wherever a post is shown.
 *
 * Every state other than live wears the existing warning pill, in the same two
 * placements: `overlay` across a thumbnail, `inline` in a row or a header. That
 * keeps one visual for "something is wrong with this post" across the grid,
 * the list, the post page and the shared report, and keeps every number on the
 * card exactly as it was -- the views were earned; the post is what changed.
 *
 * Live is the quiet default, so it is drawn only where the caller asks for it
 * (`showLive`): a small dot and the word, never a pill competing with the ones
 * that matter.
 */
export default function PostStatusChip({
  status,
  variant = "inline",
  compact = false,
  showLive = false,
}: {
  status: Pick<PostStatus, "kind" | "label" | "detail">;
  variant?: "overlay" | "inline";
  compact?: boolean;
  showLive?: boolean;
}) {
  if (status.kind === "live") {
    if (!showLive) return null;
    return (
      <span
        data-post-status="live"
        title={status.detail}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontSize: "var(--cc-t-11)",
          color: "var(--cc-text-muted)",
          whiteSpace: "nowrap",
        }}
      >
        <span
          aria-hidden="true"
          style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--cc-success)", flexShrink: 0 }}
        />
        Live
      </span>
    );
  }
  return (
    <span data-post-status={status.kind} style={{ display: "contents" }}>
      <RemovedPostOverlay variant={variant} compact={compact} label={status.label} description={status.detail} />
    </span>
  );
}
