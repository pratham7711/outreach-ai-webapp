"use client";

import { CircleSlash, CornerDownRight } from "lucide-react";
import type { AudioFieldNoticeValue } from "@/lib/campaigns/audioLinkField";

/**
 * The line under an audio field after a paste (lib/campaigns/audioLinkField):
 * the link was moved here from the field it was pasted into, or it was left
 * out and why. Neither is an error -- nothing is held back -- so it is a
 * status, in body ink, rather than a red alert.
 */
export function AudioFieldNotice({ notice }: { notice: AudioFieldNoticeValue }) {
  const dropped = notice.tone === "dropped";
  return (
    <p
      role="status"
      data-testid={dropped ? "audio-link-not-added" : "audio-link-moved"}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 6,
        margin: "6px 0 0",
        fontSize: "var(--cc-t-12)",
        color: dropped ? "var(--cc-text)" : "var(--cc-text-muted)",
      }}
    >
      {dropped ? (
        <CircleSlash size={13} color="var(--cc-warning-fg)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      ) : (
        <CornerDownRight size={13} color="var(--cc-primary)" aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      )}
      <span>
        {dropped && <strong style={{ fontWeight: "var(--cc-fw-strong)" }}>Not added. </strong>}
        {notice.text}
      </span>
    </p>
  );
}
