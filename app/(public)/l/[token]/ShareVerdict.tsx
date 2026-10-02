"use client";

import { useState } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import type { DecisionCounts, ListItemDecision, ListStatus } from "@/lib/lists/approval";
import type { SharedVerdict } from "@/lib/lists/listReview";

export type VerdictResult = { verdict: SharedVerdict; list: { status: ListStatus; counts: DecisionCounts } };

/**
 * One creator's approve / decline control on a shared list.
 *
 * Optimistic only in the sense that the buttons disable while the post is in
 * flight; the verdict shown is always the one the server stored, so a refused
 * post (link revoked, approvals switched off meanwhile) leaves the card as it
 * was and says why.
 */
export default function ShareVerdict({
  token,
  creatorId,
  creatorName,
  verdict,
  feedback,
  closed,
  onSaved,
}: {
  token: string;
  creatorId: string;
  creatorName: string;
  verdict: SharedVerdict;
  feedback: boolean;
  closed: boolean;
  onSaved: (result: VerdictResult) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noteOpen, setNoteOpen] = useState(false);
  const [note, setNote] = useState("");

  async function send(decision: ListItemDecision, withNote = "") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/l/${encodeURIComponent(token)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorId, decision, ...(withNote.trim() && { note: withNote.trim() }) }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof body.error === "string" ? body.error : "That didn't save. Try again.");
        return;
      }
      onSaved({ verdict: { ...verdict, decision: body.verdict.decision, note: body.verdict.note }, list: body.list });
      setNoteOpen(false);
      setNote("");
    } catch {
      setError("That didn't save. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const decided = verdict.decision !== "PENDING";
  return (
    <div className="cc-sl-verdict">
      <div className="cc-sl-verdict-actions">
        <button
          type="button"
          className="cc-sl-verdict-btn"
          data-verdict="APPROVED"
          aria-pressed={verdict.decision === "APPROVED"}
          aria-label={`Approve ${creatorName}`}
          disabled={busy || closed}
          onClick={() => send("APPROVED")}
        >
          <Check size={16} aria-hidden /> {verdict.decision === "APPROVED" ? "Approved" : "Approve"}
        </button>
        <button
          type="button"
          className="cc-sl-verdict-btn"
          data-verdict="REJECTED"
          aria-pressed={verdict.decision === "REJECTED"}
          aria-label={`Decline ${creatorName}`}
          disabled={busy || closed}
          onClick={() => (feedback && verdict.decision !== "REJECTED" ? setNoteOpen(true) : send("REJECTED"))}
        >
          <X size={16} aria-hidden /> {verdict.decision === "REJECTED" ? "Declined" : "Decline"}
        </button>
        {decided && !closed && (
          <button
            type="button"
            className="cc-sl-verdict-btn"
            aria-label={`Undo the decision on ${creatorName}`}
            disabled={busy}
            onClick={() => send("PENDING")}
          >
            <RotateCcw size={14} aria-hidden /> Undo
          </button>
        )}
      </div>
      {noteOpen && (
        <form
          className="cc-sl-verdict-actions"
          onSubmit={(e) => {
            e.preventDefault();
            void send("REJECTED", note);
          }}
        >
          <textarea
            className="cc-field"
            rows={2}
            maxLength={1000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Why not? (optional)"
            aria-label={`Note on ${creatorName}`}
          />
          <button type="submit" className="cc-sl-verdict-btn" disabled={busy}>
            Decline
          </button>
          <button type="button" className="cc-sl-verdict-btn" disabled={busy} onClick={() => setNoteOpen(false)}>
            Cancel
          </button>
        </form>
      )}
      {verdict.note && <p className="cc-sl-verdict-note">Your note: {verdict.note}</p>}
      {error && (
        <p className="cc-sl-verdict-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
