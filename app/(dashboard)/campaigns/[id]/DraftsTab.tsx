"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge, EmptyState, Input, Textarea } from "@pratham7711/ui";
import { Modal } from "@/components/ds/Modal";
import { Dropdown, Button, Field, Skeleton } from "@/components/ds";
import { CheckCircle2, XCircle, ExternalLink, FileText, FilePlus2, Plus, Check, X, Loader } from "lucide-react";
import { toast } from "sonner";
import { CampaignHeaderActions } from "@/components/campaigns/CampaignHeaderActions";
import { action } from "@/lib/ui/actions";
import { stripAt, formatDateAbs } from "@/lib/format";
import { enumLabel } from "@/lib/ui/enumLabel";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import { creatorNameText } from "@/lib/creators/creatorName";

type Draft = {
  id: string;
  status: string;
  draftUrl: string | null;
  draftCaption: string | null;
  draftMediaType: string | null;
  draftSubmittedAt: string | null;
  feedbackNotes: string | null;
  creator: {
    id: string;
    name: string;
    handle: string;
    platform: string;
    avatarUrl: string | null;
  };
};

const PENDING_STATUSES = ["DRAFT_SUBMITTED", "AWAITING_APPROVAL"];

const MEDIA_TYPES = ["REEL", "STORY", "POST", "SHORT", "VIDEO"] as const;

/* Only a creator who has not submitted anything yet can have a draft filed for
   them. Adding one to an activation that is already approved would quietly
   overwrite the thing that was approved. */
const AWAITING_DRAFT = "AWAITING_DRAFT";

const STATUS_BADGE: Record<string, "success" | "warning" | "danger" | "neutral"> = {
  AWAITING_DRAFT: "neutral",
  DRAFT_SUBMITTED: "warning",
  AWAITING_APPROVAL: "warning",
  APPROVED: "success",
  POSTING: "success",
  POSTED: "success",
  COMPLETE: "success",
  DECLINED: "danger",
};

/* The reference splits reviewed work into Approved and Declined beside the
   unreviewed queue, and both are already derivable from the activation status --
   the tab just never offered them, so a declined draft could only be found by
   reading every row under "All".

   "Not Reviewed" is the reference's name for what this called "Pending review".
   APPROVED covers everything downstream of approval too: a posted draft was
   approved, and filing it anywhere else would make Approved lie. */
const APPROVED_STATUSES = ["APPROVED", "POSTING", "POSTED", "COMPLETE"];

/* Their order, and their marks. MEASURED at desktop-1600: the row reads All /
   Not Reviewed / Approved / Declined, All is the one selected on load, and it
   is the only one without a glyph -- the other three lead with a spinner, a
   check and an x at 14px. */
const FILTERS = [
  { key: "ALL", label: "All", Glyph: null },
  { key: "PENDING", label: "Not Reviewed", Glyph: Loader },
  { key: "APPROVED", label: "Approved", Glyph: Check },
  { key: "DECLINED", label: "Declined", Glyph: X },
] as const;

export default function DraftsTab({
  campaignId,
  onChange,
}: {
  campaignId: string;
  onChange?: () => void | Promise<unknown>;
}) {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("ALL");
  const [declineId, setDeclineId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newDraft, setNewDraft] = useState({ activationId: "", draftUrl: "", draftCaption: "", draftMediaType: "" });
  const [savingDraft, setSavingDraft] = useState(false);

  const fetchDrafts = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/activations?campaignId=${campaignId}`);
      if (res.ok) {
        const data = await res.json();
        setDrafts(Array.isArray(data.activations) ? data.activations : []);
      } else {
        setError("Could not load drafts. Please try again.");
      }
    } catch {
      setError("Could not load drafts. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    fetchDrafts();
  }, [fetchDrafts]);

  const patch = async (id: string, body: Record<string, unknown>, successMsg: string) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/activations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        toast.success(successMsg);
        await fetchDrafts();
        await onChange?.();
      } else {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? "Action failed");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setBusyId(null);
    }
  };

  // Whoever is still owed a draft. The button is pointless with nobody to file
  // one for, so it says why rather than opening an empty dialog.
  const awaiting = drafts.filter((d) => d.status === AWAITING_DRAFT);

  const handleAddDraft = async () => {
    const { activationId, draftUrl, draftCaption, draftMediaType } = newDraft;
    if (!activationId || !draftUrl.trim()) {
      toast.error("Pick a creator and paste the draft link");
      return;
    }
    setSavingDraft(true);
    try {
      const res = await fetch(`/api/activations/${activationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draftUrl: draftUrl.trim(),
          draftCaption: draftCaption.trim() || null,
          draftMediaType: draftMediaType || null,
          // Filing a draft moves the activation into the review queue, which is
          // the whole point of filing it.
          status: "DRAFT_SUBMITTED",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => null);
        toast.error(err?.error ?? "Could not add the draft");
        return;
      }
      toast.success("Draft added");
      setAdding(false);
      setNewDraft({ activationId: "", draftUrl: "", draftCaption: "", draftMediaType: "" });
      setFilter("PENDING");
      await fetchDrafts();
      await onChange?.();
    } catch {
      toast.error("Network error");
    } finally {
      setSavingDraft(false);
    }
  };

  const handleDecline = async () => {
    if (!declineId) return;
    const id = declineId;
    const reason = declineReason.trim();
    setDeclineId(null);
    setDeclineReason("");
    await patch(id, { status: "DECLINED", feedbackNotes: reason || null }, "Revisions requested");
  };

  const visible = drafts.filter((d) => {
    switch (filter) {
      case "PENDING":
        return PENDING_STATUSES.includes(d.status);
      case "APPROVED":
        return APPROVED_STATUSES.includes(d.status);
      case "DECLINED":
        return d.status === "DECLINED";
      default:
        // "All" stays as it was: anything with a draft, plus the unreviewed.
        return !!d.draftUrl || PENDING_STATUSES.includes(d.status);
    }
  });

  if (loading) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {[1, 2, 3].map((i) => <Skeleton key={i} height={76} radius={12} />)}
      </div>
    );
  }

  if (error) {
    return (
      <Card variant="outlined" style={{ textAlign: "center" }}>
        <p style={{ fontSize: "var(--cc-t-14)", color: "var(--cc-text-muted)", marginBottom: 12 }}>{error}</p>
        <Button variant="secondary" onClick={() => { setLoading(true); fetchDrafts(); }}>Retry</Button>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="cc-pillbar">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            className="cc-pill"
            data-on={filter === f.key}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            {f.Glyph ? <f.Glyph aria-hidden /> : null}
            {f.label}
          </button>
        ))}
      </div>

      {/* In the campaign header, where theirs is: MEASURED at desktop-1600,
          their Add Draft sits on the header card's right edge, not above the
          list. */}
      <CampaignHeaderActions>
        <Button
          variant="primary"
          iconLeft={<Plus size={15} />}
          disabled={awaiting.length === 0}
          title={awaiting.length === 0 ? "Every creator on this campaign has already submitted" : undefined}
          onClick={() => setAdding(true)}
          {...action("add-draft")}
        >
          Add draft
        </Button>
      </CampaignHeaderActions>

      {visible.length === 0 ? (
        <EmptyState
          icon={<FileText size={32} color="var(--cc-text-subtle)" />}
          title={
            filter === "PENDING" ? "No drafts awaiting review"
            : filter === "APPROVED" ? "No approved drafts"
            : filter === "DECLINED" ? "No declined drafts"
            : "No drafts yet"
          }
          description="Drafts appear here once creators submit content for approval."
        />
      ) : (
        <Card variant="solid" noPadding>
          {visible.map((d, i) => {
            const pending = PENDING_STATUSES.includes(d.status);
            return (
              <div
                key={d.id}
                style={{
                  display: "flex", alignItems: "flex-start", justifyContent: "space-between",
                  gap: 16, padding: "16px 24px", flexWrap: "wrap",
                  borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flex: 1, minWidth: 240 }}>
                  <CreatorAvatar id={d.creator.id} name={d.creator.name} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <p style={{ fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>{d.creator.name}</p>
                      <Badge variant={STATUS_BADGE[d.status] ?? "neutral"} dot>{enumLabel(d.status)}</Badge>
                      {d.draftMediaType && <Badge variant="neutral">{d.draftMediaType}</Badge>}
                    </div>
                    <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>@{stripAt(d.creator.handle)}</p>
                    {d.draftCaption && (
                      <p style={{ fontSize: "var(--cc-t-13)", color: "var(--cc-text-muted)", marginTop: 6, whiteSpace: "pre-wrap" }}>
                        {d.draftCaption}
                      </p>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                      {d.draftUrl && (
                        <a
                          href={d.draftUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-primary)", textDecoration: "none" }}
                        >
                          View draft <ExternalLink size={12} />
                        </a>
                      )}
                      {d.draftSubmittedAt && (
                        <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-subtle)" }}>
                          Submitted {formatDateAbs(d.draftSubmittedAt)}
                        </span>
                      )}
                    </div>
                    {d.status === "DECLINED" && d.feedbackNotes && (
                      <p style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-danger)", marginTop: 6 }}>
                        Revisions requested: {d.feedbackNotes}
                      </p>
                    )}
                  </div>
                </div>

                {pending && (
                  <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                    <Button
                      variant="primary"
                      loading={busyId === d.id}
                      onClick={() => patch(d.id, { status: "APPROVED" }, "Draft approved")}
                    >
                      <CheckCircle2 size={14} /> Approve
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busyId === d.id}
                      onClick={() => { setDeclineId(d.id); setDeclineReason(""); }}
                    >
                      <XCircle size={14} /> Request changes
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

      {adding && (
        <Modal
          open
          onClose={() => setAdding(false)}
          icon={FilePlus2}
          tone="brand"
          title="Add draft"
          description="File the draft a creator sent you. It goes into the review queue to approve or send back."
          size="sm"
          dismissible={false}
          footer={
            <div className="cc-modal-footer">
              <Button variant="secondary" size="sm" onClick={() => setAdding(false)}>Cancel</Button>
              <Button variant="primary" size="sm" loading={savingDraft} onClick={handleAddDraft}>Add draft</Button>
            </div>
          }
        >
          <div className="cc-dialog-stack">
            <Field label="Creator" required>
              <Dropdown
                size="md"
                fullWidth
                align="left"
                placeholder="Who submitted it?"
                value={newDraft.activationId}
                onChange={(v) => setNewDraft((f) => ({ ...f, activationId: v }))}
                options={awaiting.map((a) => ({
                  value: a.id,
                  label: creatorNameText(a.creator.name, a.creator.handle),
                }))}
              />
            </Field>
            <Input
              id="new-draft-url"
              label="Draft link"
              type="url"
              value={newDraft.draftUrl}
              onChange={(e) => setNewDraft((f) => ({ ...f, draftUrl: e.target.value }))}
              placeholder="https://"
              required
            />
            <Field label="Media type">
              <Dropdown
                size="md"
                fullWidth
                align="left"
                placeholder="Optional"
                value={newDraft.draftMediaType}
                onChange={(v) => setNewDraft((f) => ({ ...f, draftMediaType: v }))}
                options={MEDIA_TYPES.map((m) => ({ value: m, label: m.charAt(0) + m.slice(1).toLowerCase() }))}
              />
            </Field>
            <Textarea
              id="new-draft-caption"
              label="Caption"
              value={newDraft.draftCaption}
              onChange={(e) => setNewDraft((f) => ({ ...f, draftCaption: e.target.value }))}
              rows={3}
              placeholder="Optional — the caption they plan to post with"
            />
          </div>
        </Modal>
      )}

      {declineId && (
        <Modal
          open
          onClose={() => { setDeclineId(null); setDeclineReason(""); }}
          icon={XCircle}
          tone="danger"
          title="Request changes"
          description="The draft moves to Declined, with your note on what to change."
          size="sm"
          dismissible={false}
          footer={
            <div className="cc-modal-footer">
              <Button variant="secondary" size="sm" onClick={() => { setDeclineId(null); setDeclineReason(""); }}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={handleDecline}>
                Send back for revision
              </Button>
            </div>
          }
        >
          <Textarea
            label="What to change"
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            rows={3}
            placeholder="What needs to change before this can be approved?"
          />
        </Modal>
      )}
    </div>
  );
}
