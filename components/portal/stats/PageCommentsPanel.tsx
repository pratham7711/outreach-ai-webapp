"use client";

import { useState } from "react";
import { formatCount, formatDay, secondaryButtonStyle } from "@/components/portal/app/ui";

type PageComment = { id: string; message: string; authorName: string | null; createdAt: string | null; likeCount: number | null };
type PageComments = { total: number | null; preview: PageComment[]; pageName: string; readAt: string; stored: boolean };
type CommentsState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "failed"; reason: string }
  | { status: "read"; comments: PageComments };

/** What people wrote on one of the creator's own Facebook Page posts, read
    live from Facebook when they ask and never saved (pages_read_user_content,
    app/api/portal/insights/comments). */
export default function PageCommentsPanel({ postId }: { postId: string }) {
  const [state, setState] = useState<CommentsState>({ status: "idle" });
  const failed = "We couldn't read this post's comments. Try again.";

  const read = async () => {
    setState({ status: "loading" });
    try {
      const res = await fetch(`/api/portal/insights/comments?post=${encodeURIComponent(postId)}`, { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) setState({ status: "failed", reason: body?.reason ?? failed });
      else setState({ status: "read", comments: body as PageComments });
    } catch {
      setState({ status: "failed", reason: failed });
    }
  };

  const shown = state.status === "read" ? state.comments : null;
  return (
    <div style={{ marginTop: 10 }}>
      <button
        type="button"
        onClick={shown ? () => setState({ status: "idle" }) : read}
        disabled={state.status === "loading"}
        aria-expanded={Boolean(shown)}
        className="rsp-touch"
        style={{ ...secondaryButtonStyle, minHeight: 30, padding: "5px 12px", fontSize: 13 }}
      >
        {state.status === "loading" ? "Reading comments…" : shown ? "Hide comments" : "Show comments"}
      </button>
      {state.status === "failed" && (
        <p role="alert" style={{ fontSize: 13, color: "var(--cc-danger)", margin: "8px 0 0" }}>{state.reason}</p>
      )}
      {shown && (
        <div style={{ marginTop: 12, padding: "12px 14px", borderRadius: 10, background: "var(--cc-hover-bg)" }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 10px" }}>
            {shown.total === null ? "Comments" : `${formatCount(shown.total)} ${shown.total === 1 ? "comment" : "comments"}`}
            {shown.pageName ? <span style={{ fontWeight: 400, color: "var(--cc-text-muted)" }}> on {shown.pageName}</span> : ""}
          </p>
          {shown.preview.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--cc-text-muted)", margin: 0 }}>
              {shown.total === 0
                ? "Nobody has commented on this post yet."
                : "Facebook returned the count but no comment text for this post."}
            </p>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              {shown.preview.map((c) => (
                <li key={c.id} style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>{c.authorName ?? "Facebook user"}</span>
                  {c.createdAt && (
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}> · {formatDay(c.createdAt)}</span>
                  )}
                  <p style={{ fontSize: 14, color: "var(--cc-text)", margin: "2px 0 0", lineHeight: 1.5, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                    {c.message || "(no text: a photo or sticker)"}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "10px 0 0" }}>
            {shown.total !== null && shown.total > shown.preview.length && shown.preview.length > 0
              ? `The ${shown.preview.length} most recent. `
              : ""}
            Read live from Facebook just now{shown.stored ? "" : ", not saved"}.
          </p>
        </div>
      )}
    </div>
  );
}
