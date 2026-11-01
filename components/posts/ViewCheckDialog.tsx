"use client";

import React, { useEffect, useState } from "react";
import { Badge, Modal } from "@pratham7711/ui";
import { Button } from "@/components/ds";
import { toast } from "sonner";
import { viewCheckCards, viewCheckSeverity, type ViewCheckFlag } from "@/lib/fraud/flagCopy";
import { noun } from "@/lib/ui/noun";

/** Mirrors EXCLUSION_REASON_MAX in lib/posts/annotations (a server module). */
const REASON_MAX = 200;

/**
 * Why a post was flagged for a view check, and what to do about it: look at
 * the post, then either mark the check reviewed or exclude the post from the
 * campaign's totals with a reason. Reviewed flags stay on file and are not
 * raised again for the same evidence; a new spike raises a new one. Excluding
 * is the ordinary soft remove (it can be undone from Removed), with the reason
 * kept on the post.
 */
export function ViewCheckDialog({
  campaignId,
  postId,
  creatorName,
  postUrl,
  marketplace,
  onClose,
  onCleared,
  onExcluded,
}: {
  campaignId: string;
  postId: string;
  creatorName: string;
  postUrl: string;
  /** Open flags hold a submission back from auto-approval; only said where that applies. */
  marketplace: boolean;
  onClose: () => void;
  /** Every open flag on the post has been marked reviewed. */
  onCleared: (postId: string) => void;
  /** The post was taken out of the campaign's totals; `ids` is what the call
      removed, `flagIds` the checks it marked reviewed (Undo reopens them). */
  onExcluded?: (ids: string[], flagIds: string[]) => void;
}) {
  const [flags, setFlags] = useState<ViewCheckFlag[] | null>(null);
  const [elsewhere, setElsewhere] = useState(0);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [excluding, setExcluding] = useState(false);
  const [reason, setReason] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/campaigns/${campaignId}/fraud-flags?resolved=false`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { flags?: ViewCheckFlag[]; otherCampaigns?: Record<string, number> }) => {
        if (!live) return;
        const mine = (data.flags ?? []).filter((f) => f.postId === postId);
        setFlags(mine);
        const creatorId = mine[0]?.creatorId;
        setElsewhere(creatorId ? data.otherCampaigns?.[creatorId] ?? 0 : 0);
      })
      .catch(() => live && setFailed(true));
    return () => { live = false; };
  }, [campaignId, postId]);

  const markReviewed = async () => {
    if (!flags || flags.length === 0) return;
    setSaving(true);
    try {
      for (const f of flags) {
        const res = await fetch(`/api/fraud-flags/${f.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isResolved: true }),
        });
        if (!res.ok) throw new Error(res.status === 403 ? "forbidden" : String(res.status));
      }
      toast.success("Marked reviewed");
      onCleared(postId);
      onClose();
    } catch (e) {
      toast.error(e instanceof Error && e.message === "forbidden"
        ? "Your role can't mark view checks reviewed."
        : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  /* The reason goes on the post and into the audit log. The flags are then
     marked reviewed, since excluding is the review's outcome; if that part
     fails the post is still excluded, so it is not reported as an error.
     Not before the flags have loaded, or the post would leave totals with
     its checks still open. */
  const exclude = async () => {
    const why = reason.trim();
    if (!why || !flags) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/posts`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postIds: [postId], reason: why }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? "Couldn't exclude the post.");
        return;
      }
      const reviewed: string[] = [];
      for (const f of flags) {
        const r = await fetch(`/api/fraud-flags/${f.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isResolved: true }),
        }).catch(() => null);
        if (r?.ok) reviewed.push(f.id);
      }
      onExcluded?.(Array.isArray(body.postIds) ? body.postIds : [postId], reviewed);
      onClose();
    } catch {
      toast.error("Couldn't exclude the post. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Check this post's views"
      size="md"
      footer={
        <div className="cc-modal-footer" style={{ flexWrap: "wrap" }}>
          {excluding ? (
            <>
              <Button variant="secondary" disabled={saving} onClick={() => setExcluding(false)}>Back</Button>
              <Button variant="primary" loading={saving} disabled={!reason.trim() || !flags} onClick={exclude} data-testid="view-check-exclude-confirm">
                Exclude post
              </Button>
            </>
          ) : (
            <>
              {onExcluded && (
                <Button variant="secondary" disabled={saving || !flags} onClick={() => setExcluding(true)} style={{ color: "var(--cc-danger)" }}>
                  Exclude from totals
                </Button>
              )}
              <Button variant="secondary" onClick={onClose}>Close</Button>
              <Button variant="primary" loading={saving} disabled={!flags || flags.length === 0} onClick={markReviewed}>
                Mark reviewed
              </Button>
            </>
          )}
        </div>
      }
    >
      <div data-testid="view-check-dialog" style={{ display: "flex", flexDirection: "column", gap: 14, fontSize: "var(--cc-t-14)", color: "var(--cc-text)" }}>
        <p style={{ margin: 0, color: "var(--cc-text-muted)", lineHeight: 1.5 }}>
          {creatorName}&rsquo;s post tripped a view check. This is a reason to look, not a finding: open the post, compare
          its comments with its views, and mark it reviewed if it looks right.
          {marketplace ? " Until then it is held back from auto-approval." : ""}
        </p>
        {/* In the body, beside the step it belongs to: in the footer it
            pushed the buttons past a phone's width once Exclude was on. */}
        <a href={postUrl} target="_blank" rel="noopener noreferrer" style={{ alignSelf: "flex-start", fontSize: "var(--cc-t-14)", fontWeight: 600, color: "var(--cc-primary)" }}>
          Open the post ↗
        </a>
        {failed && <p style={{ margin: 0, color: "var(--cc-danger)" }}>Couldn&rsquo;t load the details. Close and try again.</p>}
        {!failed && flags === null && <p style={{ margin: 0, color: "var(--cc-text-muted)" }}>Loading…</p>}
        {flags?.length === 0 && <p style={{ margin: 0, color: "var(--cc-text-muted)" }}>Nothing open on this post any more.</p>}
        {flags && viewCheckCards(flags).map((c) => {
          const sev = viewCheckSeverity(c.severity);
          return (
            <div key={c.key} style={{ border: "1px solid var(--cc-border)", borderRadius: 10, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                <strong style={{ fontWeight: 600 }}>{c.title}</strong>
                <Badge variant={sev.tone}>{sev.label}</Badge>
              </div>
              <span style={{ color: "var(--cc-text-muted)", lineHeight: 1.5 }}>{c.detail}</span>
            </div>
          );
        })}
        {excluding && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label htmlFor="view-check-reason" style={{ fontWeight: 600 }}>Why are you excluding it?</label>
            <input
              id="view-check-reason"
              autoFocus
              value={reason}
              maxLength={REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
              /* Enter is the confirm button, as in any one-field form; not
                 mid-composition (an IME's Enter picks a candidate). */
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.nativeEvent.isComposing || saving || !reason.trim() || !flags) return;
                e.preventDefault();
                void exclude();
              }}
              placeholder="e.g. Views bought; engagement doesn't match"
              style={{ padding: "8px 10px", borderRadius: 8, border: "1px solid var(--cc-border)", background: "var(--cc-card)", color: "var(--cc-text)", fontSize: "var(--cc-t-14)", fontFamily: "inherit" }}
            />
            <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)", lineHeight: 1.5 }}>
              The post leaves this campaign&rsquo;s totals and moves to Removed with this reason. Restore it there to undo.
            </span>
          </div>
        )}
        {elsewhere > 0 && (
          <p data-testid="view-check-elsewhere" style={{ margin: 0, fontSize: "var(--cc-t-13)", color: "var(--cc-text)" }}>
            This creator also has an unreviewed view check on {elsewhere} other {noun(elsewhere, "campaign")}.
          </p>
        )}
      </div>
    </Modal>
  );
}
