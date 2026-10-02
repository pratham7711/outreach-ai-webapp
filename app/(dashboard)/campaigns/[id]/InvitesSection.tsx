"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Modal, EmptyState, Skeleton } from "@pratham7711/ui";
import { Send, Copy, RotateCcw, X, Mail } from "lucide-react";
import { CreatorSelect } from "@/components/CreatorSelect";
import { Dropdown, Button } from "@/components/ds";
import { formatDateAbs } from "@/lib/format";
import CreatorAvatar from "@/components/creators/CreatorAvatar";
import { creatorNameText } from "@/lib/creators/creatorName";
import { campaignInvitePath } from "@/lib/portal/invitePath";

type Invite = {
  id: string;
  creatorId: string;
  /** Resolved by the route; null once the creator has been deleted. */
  creator: { id: string; name: string; handle: string } | null;
  channel: string;
  inviteToken: string;
  status: string;
  sentAt: string | null;
  respondedAt: string | null;
  createdAt: string;
};

const STATUS_BADGE: Record<string, "warning" | "success" | "danger" | "neutral"> = {
  PENDING: "warning",
  ACCEPTED: "success",
  DECLINED: "danger",
  EXPIRED: "neutral",
};

/* The Creator column is the whole point of this table and it was printing a
   truncated cuid. The route resolves the name now; this only formats it. */
function creatorName(creator: { name: string; handle: string } | null): string {
  return creator ? creatorNameText(creator.name, creator.handle) : "Deleted creator";
}

export default function InvitesSection({ campaignId }: { campaignId: string }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ creatorId: "", channel: "LINK" });
  const [copied, setCopied] = useState<string | null>(null);

  const fetchInvites = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/invites`);
    if (res.ok) {
      const data = await res.json();
      setInvites(Array.isArray(data.invites) ? data.invites : []);
    }
    setLoading(false);
  }, [campaignId]);

  useEffect(() => { fetchInvites(); }, [fetchInvites]);

  const openCreate = () => setShowCreate(true);

  const handleCreate = async () => {
    if (!form.creatorId) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setShowCreate(false);
        setForm({ creatorId: "", channel: "LINK" });
        fetchInvites();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleAction = async (inviteId: string, action: "RESEND" | "CANCEL") => {
    await fetch(`/api/campaigns/${campaignId}/invites/${inviteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    fetchInvites();
  };

  const copyLink = (token: string) => {
    /* The creator-facing landing page (/invite/<token>), with the brief, the
       dates and Accept. This used to copy the POST-only respond API, which a
       browser opens as a 405. */
    navigator.clipboard.writeText(`${window.location.origin}${campaignInvitePath(token)}`);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) return <Skeleton width="100%" height="100px" borderRadius="12px" />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span className="cc-panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Send size={16} /> Campaign Invites
        </span>
        <Button variant="primary" onClick={openCreate}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Send size={14} /> Invite Creator</span>
        </Button>
      </div>

      {invites.length === 0 ? (
        <Card variant="outlined" style={{ padding: 24 }}>
          <EmptyState icon={<Mail size={32} color="var(--cc-text-subtle)" />} title="No invites sent" description="Invite creators to join this campaign." />
        </Card>
      ) : (
        <Card variant="solid" noPadding>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 100px 100px 120px 120px 140px",
            gap: 12, padding: "12px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-bg)",
          }}>
            {["Creator", "Channel", "Status", "Sent", "Responded", "Actions"].map(h => (
              <span key={h} className="cc-microlabel">{h}</span>
            ))}
          </div>
          {invites.map((inv, i) => (
            <div key={inv.id} style={{
              display: "grid", gridTemplateColumns: "1fr 100px 100px 120px 120px 140px",
              gap: 12, padding: "14px 24px", alignItems: "center",
              borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
            }}>
              <span style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, fontSize: "var(--cc-t-14)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)" }}>
                <CreatorAvatar id={inv.creator?.id ?? inv.creatorId} name={inv.creator?.name ?? "Deleted creator"} size="sm" />
                <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{creatorName(inv.creator)}</span>
              </span>
              <Badge variant="neutral" style={{ fontSize: "var(--cc-t-11)"}}>{inv.channel}</Badge>
              <Badge variant={STATUS_BADGE[inv.status] ?? "neutral"}>{inv.status}</Badge>
              <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>{inv.sentAt ? formatDateAbs(inv.sentAt) : "—"}</span>
              <span style={{ fontSize: "var(--cc-t-12)", color: "var(--cc-text-muted)" }}>{inv.respondedAt ? formatDateAbs(inv.respondedAt) : "—"}</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => copyLink(inv.inviteToken)} title="Copy link" style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--cc-border)", background: "var(--cc-card)", cursor: "pointer", fontSize: "var(--cc-t-11)", display: "flex", alignItems: "center", gap: 2, color: "var(--cc-text-muted)" }}>
                  <Copy size={12} /> {copied === inv.inviteToken ? "Copied!" : "Link"}
                </button>
                {inv.status === "PENDING" && (
                  <>
                    <button onClick={() => handleAction(inv.id, "RESEND")} style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--cc-border)", background: "var(--cc-card)", cursor: "pointer", fontSize: "var(--cc-t-11)", display: "flex", alignItems: "center", gap: 2, color: "var(--cc-text-muted)" }}>
                      <RotateCcw size={12} /> Resend
                    </button>
                    <button onClick={() => handleAction(inv.id, "CANCEL")} style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--cc-danger)", background: "color-mix(in srgb, var(--cc-danger) 14%, transparent)", cursor: "pointer", fontSize: "var(--cc-t-11)", display: "flex", alignItems: "center", gap: 2, color: "var(--cc-danger-ink)" }}>
                      <X size={12} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}

      {/* Invite Creator Modal */}
      {showCreate && (
        /* "Draft with AI" sat on the left of this footer until October 2026.
           The route and OutreachDraftPanel are still in the repo; the button
           is not, along with the rest of the AI outreach surface. */
        <Modal open={true} onClose={() => setShowCreate(false)} title="Invite Creator" size="md" footer={
          <div className="cc-modal-footer" data-layout="split">
            <div />
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button variant="primary" loading={submitting} onClick={handleCreate} disabled={!form.creatorId}>Send Invite</Button>
            </div>
          </div>
        }>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 }}>Creator</label>
              <CreatorSelect
                value={form.creatorId}
                onChange={(id) => setForm(f => ({ ...f, creatorId: id }))}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: "var(--cc-t-13)", fontWeight: "var(--cc-fw-strong)", color: "var(--cc-text)", marginBottom: 6 }}>Channel</label>
              <Dropdown
                ariaLabel="Channel"
                align="left"
                fullWidth
                value={form.channel}
                onChange={(v) => setForm(f => ({ ...f, channel: v }))}
                options={[
                  { value: "LINK", label: "Shareable Link" },
                  { value: "INSTAGRAM_DM", label: "Instagram DM" },
                ]}
              />
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
