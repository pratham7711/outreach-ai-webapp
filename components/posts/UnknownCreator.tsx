"use client";

import { UserRoundSearch } from "lucide-react";
import {
  UNKNOWN_CREATOR_LABEL,
  UNKNOWN_CREATOR_NEXT,
  notPublicCreatorReason,
  unknownCreatorReason,
} from "@/lib/posts/unattributedName";

/**
 * Where a creator's name goes on a post nobody could attribute.
 *
 * The post is filed under the org's Unattributed row, whose name ("Unattributed
 * Instagram posts") is our filing label, not a person -- and it was rendered as
 * if it were one, avatar initials and all. This says what is actually known:
 * no creator yet, the platform's reason, and that finding one is automatic.
 * Nothing here asks the viewer to supply a creator; see lib/posts/detectCreator.
 */
export default function UnknownCreator({
  platform,
  tone = "default",
  notPublic = false,
  ageLimitPossible = false,
}: {
  platform: string;
  /** "overlay" for the dark gradient over a post thumbnail. */
  tone?: "default" | "overlay";
  /** The platform does not show the post publicly (isPostNotPublic). */
  notPublic?: boolean;
  /** Not public but not removed, so the creator's age limit may be why (mayBeAgeLimited). */
  ageLimitPossible?: boolean;
}) {
  const overlay = tone === "overlay";
  const reason = notPublic
    ? `${notPublicCreatorReason(platform, ageLimitPossible)}.`
    : `${unknownCreatorReason(platform)}. ${UNKNOWN_CREATOR_NEXT}.`;
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
    </span>
  );
}
