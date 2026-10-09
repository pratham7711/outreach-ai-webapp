"use client";

import { UserPlus, UserRoundSearch } from "lucide-react";
import { UNKNOWN_CREATOR_LABEL, unknownCreatorReason } from "@/lib/posts/unattributedName";

/**
 * Where a creator's name goes on a post nobody could attribute.
 *
 * The post is filed under the org's Unattributed row, whose name ("Unattributed
 * Instagram posts") is our filing label, not a person -- and it was rendered as
 * if it were one, avatar initials and all. This says what is actually known:
 * no creator, the platform's reason, and the one thing that fixes it.
 */
export default function UnknownCreator({
  platform,
  onAssign,
  tone = "default",
}: {
  platform: string;
  /** Absent where the viewer may not assign one. */
  onAssign?: () => void;
  /** "overlay" for the dark gradient over a post thumbnail. */
  tone?: "default" | "overlay";
}) {
  const overlay = tone === "overlay";
  const reason = unknownCreatorReason(platform);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flexWrap: "wrap" }}>
      <span
        aria-hidden="true"
        style={{
          width: 24,
          height: 24,
          borderRadius: "50%",
          flex: "none",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          border: `1px dashed ${overlay ? "var(--cc-overlay-ink-text)" : "var(--cc-text-subtle)"}`,
          color: overlay ? "var(--cc-overlay-ink-text)" : "var(--cc-text-muted)",
        }}
      >
        <UserRoundSearch size={13} />
      </span>
      <span style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: "1 1 auto" }}>
        <span
          style={{
            fontSize: "var(--cc-t-13)",
            fontWeight: "var(--cc-fw-strong)",
            color: overlay ? "var(--cc-overlay-ink-text)" : "var(--cc-text)",
          }}
        >
          {UNKNOWN_CREATOR_LABEL}
        </span>
        <span
          title={reason}
          style={{
            fontSize: "var(--cc-t-11)",
            color: overlay ? "var(--cc-overlay-ink-text)" : "var(--cc-text-muted)",
            opacity: overlay ? 0.8 : 1,
            lineHeight: 1.3,
          }}
        >
          {reason}
        </span>
      </span>
      {onAssign && (
        <button
          type="button"
          onClick={(e) => {
            /* The card and the row are both links out to the platform. */
            e.preventDefault();
            e.stopPropagation();
            onAssign();
          }}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "3px 8px",
            borderRadius: 6,
            border: `1px solid ${overlay ? "var(--cc-overlay-ink-text)" : "var(--cc-primary)"}`,
            background: overlay ? "transparent" : "var(--cc-card)",
            color: overlay ? "var(--cc-overlay-ink-text)" : "var(--cc-primary)",
            fontSize: "var(--cc-t-12)",
            fontWeight: "var(--cc-fw-strong)",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          <UserPlus size={12} aria-hidden="true" />
          Assign creator
        </button>
      )}
    </span>
  );
}
