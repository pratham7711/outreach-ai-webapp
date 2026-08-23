"use client";

import React from "react";
import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Button, Modal, EmptyState, Skeleton, Avatar } from "@pratham7711/ui";
import { CheckCircle2, XCircle, ExternalLink, FileText } from "lucide-react";
import { toast } from "sonner";
import { stripAt, formatDateAbs } from "@/lib/format";

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

const FILTERS = [
  { key: "PENDING", label: "Not Reviewed" },
  { key: "APPROVED", label: "Approved" },
  { key: "DECLINED", label: "Declined" },
  { key: "ALL", label: "All" },
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
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("PENDING");
  const [declineId, setDeclineId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

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
        {[1, 2, 3].map((i) => <Skeleton key={i} height="76px" borderRadius="12px" />)}
      </div>
    );
  }

  if (error) {
    return (
      <Card variant="outlined" style={{ padding: 24, textAlign: "center" }}>
        <p style={{ fontSize: 14, color: "var(--cc-text-muted)", marginBottom: 12 }}>{error}</p>
        <Button variant="secondary" onClick={() => { setLoading(true); fetchDrafts(); }}>Retry</Button>
      </Card>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 8 }}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            style={{
              padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
              border: `1px solid ${filter === f.key ? "var(--cc-primary)" : "var(--cc-border)"}`,
              background: filter === f.key ? "var(--cc-primary-light)" : "var(--cc-card)",
              color: filter === f.key ? "var(--cc-primary)" : "var(--cc-text-muted)",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

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
                  <Avatar name={d.creator.name} src={d.creator.avatarUrl ?? undefined} size="sm" />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{d.creator.name}</p>
                      <Badge variant={STATUS_BADGE[d.status] ?? "neutral"} dot>{d.status.replace(/_/g, " ")}</Badge>
                      {d.draftMediaType && <Badge variant="neutral">{d.draftMediaType}</Badge>}
                    </div>
                    <p style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>@{stripAt(d.creator.handle)}</p>
                    {d.draftCaption && (
                      <p style={{ fontSize: 13, color: "var(--cc-text-muted)", marginTop: 6, whiteSpace: "pre-wrap" }}>
                        {d.draftCaption}
                      </p>
                    )}
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6, flexWrap: "wrap" }}>
                      {d.draftUrl && (
                        <a
                          href={d.draftUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, fontWeight: 600, color: "var(--cc-primary)", textDecoration: "none" }}
                        >
                          View draft <ExternalLink size={12} />
                        </a>
                      )}
                      {d.draftSubmittedAt && (
                        <span style={{ fontSize: 12, color: "var(--cc-text-subtle)" }}>
                          Submitted {formatDateAbs(d.draftSubmittedAt)}
                        </span>
                      )}
                    </div>
                    {d.status === "DECLINED" && d.feedbackNotes && (
                      <p style={{ fontSize: 12, color: "#DC2626", marginTop: 6 }}>
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

      {declineId && (
        <Modal
          open
          onClose={() => { setDeclineId(null); setDeclineReason(""); }}
          title="Request changes"
          size="sm"
          footer={
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <Button variant="secondary" onClick={() => { setDeclineId(null); setDeclineReason(""); }}>Cancel</Button>
              <Button variant="primary" style={{ background: "#DC2626" }} onClick={handleDecline}>
                Send back for revision
              </Button>
            </div>
          }
        >
          <textarea
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
            rows={3}
            placeholder="What needs to change before this can be approved?"
            style={{
              width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-border)",
              fontSize: 14, color: "var(--cc-text)", background: "var(--cc-card)", outline: "none",
              resize: "vertical", fontFamily: "inherit", boxSizing: "border-box",
            }}
          />
        </Modal>
      )}
    </div>
  );
}
