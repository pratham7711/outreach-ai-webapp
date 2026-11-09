"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge } from "@pratham7711/ui";
import { Modal, ModalOption, ModalOptionList, ModalSection } from "@/components/ds/Modal";
import { Send, Copy, RotateCcw, X, Link2, MessageCircle } from "lucide-react";
import { CreatorSelect } from "@/components/CreatorSelect";
import { Button, Skeleton } from "@/components/ds";
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

const INVITE_CHANNELS = [
  { value: "LINK", label: "Shareable Link", icon: Link2, description: "Send the link however you like." },
  { value: "INSTAGRAM_DM", label: "Instagram DM", icon: MessageCircle, description: "Marks the invite as sent in an Instagram DM." },
] as const;

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

  if (loading) return <Skeleton width="100%" height={100} radius="var(--cc-r-card)" />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span className="cc-panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Send size={16} /> Campaign invites
        </span>
        <Button variant="primary" onClick={openCreate}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Send size={14} /> Invite creator</span>
        </Button>
      </div>

      {/* No empty card: the Invite creator button above already says what to do,
          and a bordered "No invites sent" box was most of this tab for every
          campaign that never used invites. One muted line instead, so the
          heading is not left with nothing under it. */}
      {invites.length === 0 && <p className="cc-invites-empty">No invites sent yet.</p>}
      {invites.length > 0 && (
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

      {/* Invite creator modal */}
      {showCreate && (
        /* "Draft with AI" sat on the left of this footer until October 2026.
           The route and OutreachDraftPanel are still in the repo; the button
           is not, along with the rest of the AI outreach surface. */
        <Modal
          open={true}
          onClose={() => setShowCreate(false)}
          icon={Send}
          tone="brand"
          title="Invite creator"
          description="Creates an invite for this campaign. Copy its link from the invites list to send it."
          size="md"
          footer={
            <div className="cc-modal-footer">
              <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button
                variant="primary"
                size="sm"
                loading={submitting}
                onClick={handleCreate}
                disabled={!form.creatorId}
                iconLeft={<Send size={16} aria-hidden="true" />}
              >
                Send invite
              </Button>
            </div>
          }
        >
          <ModalSection title="Creator">
            <CreatorSelect
              value={form.creatorId}
              onChange={(id) => setForm(f => ({ ...f, creatorId: id }))}
            />
          </ModalSection>
          {/* How it goes out is a question about a creator, so it waits for one. */}
          {form.creatorId && (
            <ModalSection title="Channel">
              <ModalOptionList>
                {INVITE_CHANNELS.map((c) => (
                  <ModalOption
                    key={c.value}
                    icon={c.icon}
                    title={c.label}
                    description={c.description}
                    control={
                      <input
                        type="radio"
                        name="invite-channel"
                        value={c.value}
                        checked={form.channel === c.value}
                        onChange={() => setForm(f => ({ ...f, channel: c.value }))}
                        style={{ width: 18, height: 18, accentColor: "var(--cc-primary)", cursor: "pointer" }}
                      />
                    }
                  />
                ))}
              </ModalOptionList>
            </ModalSection>
          )}
        </Modal>
      )}
    </div>
  );
}
