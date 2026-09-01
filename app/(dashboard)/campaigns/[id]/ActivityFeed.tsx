"use client";

import React from "react";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Card, EmptyState, Skeleton } from "@pratham7711/ui";
import { StatusTabs, Button } from "@/components/ds";
import { History } from "lucide-react";

type ActivityEvent = {
  id: string;
  glyph: string;
  text: string;
  createdAt: string;
  kind: "event" | "comment";
};

const FILTER_TABS = [
  { key: "all", label: "All", bg: "#F3F4F6", color: "#374151" },
  { key: "comments", label: "Comments", bg: "#EEF2FF", color: "#4F46E5" },
];

function relative(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

export default function ActivityFeed({ campaignId }: { campaignId: string }) {
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/activity`);
      if (!res.ok) throw new Error("Failed to load activity");
      const data = await res.json();
      setEvents(data.events ?? []);
    } catch {
      setError("Could not load activity.");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => { void load(); }, [load]);

  const [draft, setDraft] = useState("");
  const [posting, setPosting] = useState(false);

  const postComment = async () => {
    const content = draft.trim();
    if (!content || posting) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/activity`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d?.error ?? "Could not post that comment.");
        return;
      }
      setDraft("");
      /* Refetch rather than splice the new comment in locally: the feed
         interleaves comments with audit events by timestamp, and a client-side
         insert would have to duplicate that ordering to stay honest. */
      await load();
    } finally {
      setPosting(false);
    }
  };

  const shown = useMemo(
    () => (filter === "comments" ? events.filter((e) => e.kind === "comment") : events),
    [events, filter]
  );

  return (
    <Card variant="outlined" style={{ padding: 24 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)" }}>Activity</span>
        <StatusTabs
          variant="pill"
          ariaLabel="Filter activity"
          tabs={FILTER_TABS}
          active={filter}
          onChange={setFilter}
        />
      </div>

      {/* The composer. Without it CampaignComment was a table nothing could
          write to, so the read path and the Comments filter both sat over
          permanently empty data. */}
      <div style={{ marginBottom: 18 }}>
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            /* Enter sends, Shift+Enter breaks the line — the convention
               everywhere else people leave short notes. */
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void postComment(); }
          }}
          placeholder="Leave a note for the team…"
          aria-label="Write a comment"
          rows={2}
          disabled={posting}
          style={{
            width: "100%", resize: "vertical", padding: "10px 12px",
            borderRadius: 10, border: "1px solid var(--cc-border)",
            background: "var(--cc-card)", color: "var(--cc-text)",
            fontSize: 13, fontFamily: "inherit", lineHeight: 1.5,
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
          <span style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>
            Enter to post · Shift+Enter for a new line
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void postComment()}
            disabled={posting || draft.trim().length === 0}
          >
            {posting ? "Posting…" : "Comment"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height="20px" borderRadius="6px" />
          ))}
        </div>
      ) : error ? (
        <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{error}</span>
      ) : shown.length === 0 ? (
        <EmptyState
          icon={<History size={28} color="var(--cc-text-subtle)" />}
          title={filter === "comments" ? "No comments yet" : "No activity yet"}
          description={
            filter === "comments"
              ? "Comments on this campaign will appear here."
              : "Adding creators, posting, and status changes all show up here."
          }
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {shown.map((e) => (
            <div key={e.id} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
              <span aria-hidden style={{ fontSize: 15, lineHeight: "20px", flexShrink: 0 }}>{e.glyph}</span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, color: "var(--cc-text)", lineHeight: 1.5, overflowWrap: "anywhere" }}>{e.text}</div>
                <div style={{ fontSize: 11, color: "var(--cc-text-muted)", marginTop: 2 }}>{relative(e.createdAt)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
