"use client";

import Link from "next/link";
import type { JoinedCampaign } from "@/lib/portal/myCampaigns";
import { StatusPill, formatDay, relativeDay, type Tone } from "@/components/portal/app/ui";

/** Where a joined campaign stands, from the creator's side. */
export function campaignState(c: JoinedCampaign): { tone: Tone; label: string } {
  if (!c.actionable) return { tone: "neutral", label: "Closed" };
  if (c.feedback) return { tone: "warning", label: "Changes requested" };
  if (c.postsSubmitted > 0) return { tone: "success", label: c.postsSubmitted === 1 ? "1 post in" : `${c.postsSubmitted} posts in` };
  return { tone: "info", label: "To post" };
}

export function CampaignRow({ c }: { c: JoinedCampaign }) {
  const state = campaignState(c);
  return (
    <Link
      href={c.href}
      style={{
        display: "block",
        padding: 14,
        borderRadius: 12,
        border: "1px solid var(--cc-border)",
        background: "var(--cc-card)",
        textDecoration: "none",
        color: "inherit",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: "var(--cc-text)" }}>{c.title}</div>
          <div style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{c.orgName}</div>
        </div>
        <StatusPill tone={state.tone}>{state.label}</StatusPill>
      </div>
      <div style={{ fontSize: 13, color: "var(--cc-text)", marginTop: 10 }}>
        {c.next ? (
          <>
            <strong style={{ fontWeight: 600 }}>{c.next.label}</strong> · {formatDay(c.next.at)}{" "}
            <span style={{ color: "var(--cc-text-muted)" }}>({relativeDay(c.next.at)})</span>
          </>
        ) : (
          <span style={{ color: "var(--cc-text-muted)" }}>No upcoming dates</span>
        )}
      </div>
    </Link>
  );
}
