"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Button, Modal, EmptyState, Skeleton } from "@pratham7711/ui";
import { Send, Copy, RotateCcw, X, Mail, Sparkles } from "lucide-react";
import { CreatorSelect } from "@/components/CreatorSelect";
import { Dropdown } from "@/components/ds";
import { formatDateAbs } from "@/lib/format";
import { OutreachDraftPanel } from "@/components/ai/OutreachDraftPanel";

type AiDraft = {
  subject: string;
  body: string;
  groundedFacts: string[];
  grounding: { ok: boolean; unsupportedNumbers: string[] } | null;
};

type Invite = {
  id: string;
  creatorId: string;
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

export default function InvitesSection({ campaignId }: { campaignId: string }) {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({ creatorId: "", channel: "LINK" });
  const [copied, setCopied] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);

  const fetchInvites = useCallback(async () => {
    const res = await fetch(`/api/campaigns/${campaignId}/invites`);
    if (res.ok) {
      const data = await res.json();
      setInvites(Array.isArray(data.invites) ? data.invites : []);
    }
    setLoading(false);
  }, [campaignId]);

  useEffect(() => { fetchInvites(); }, [fetchInvites]);

  const openCreate = () => {
    setShowCreate(true);
    setDraft(null);
    setDraftError(null);
  };

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

  const handleDraft = async () => {
    if (!form.creatorId) return;
    setDrafting(true);
    setDraftError(null);
    setDraft(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/outreach/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ creatorIds: [form.creatorId] }),
      });
      if (res.status === 403) { setDraftError("The AI assistant isn't enabled on this workspace's plan."); return; }
      if (res.status === 503) { setDraftError("AI drafting isn't configured on the server yet."); return; }
      if (!res.ok) { setDraftError("Couldn't generate a draft. Try again."); return; }
      const data = await res.json();
      const d = Array.isArray(data.drafts) ? data.drafts[0] : null;
      if (!d || d.error || !d.subject) { setDraftError(d?.error || "No draft was returned."); return; }
      setDraft({
        subject: d.subject,
        body: d.body ?? "",
        groundedFacts: Array.isArray(d.groundedFacts) ? d.groundedFacts : [],
        grounding: d.grounding ?? null,
      });
    } catch {
      setDraftError("Couldn't reach the drafting service.");
    } finally {
      setDrafting(false);
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
    navigator.clipboard.writeText(`${window.location.origin}/api/campaign-invites/respond?token=${token}`);
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  };


  if (loading) return <Skeleton width="100%" height="100px" borderRadius="12px" />;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <span style={{ fontWeight: 700, fontSize: 15, color: "var(--cc-text)", display: "flex", alignItems: "center", gap: 8 }}>
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
              <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--cc-text-subtle)" }}>{h}</span>
            ))}
          </div>
          {invites.map((inv, i) => (
            <div key={inv.id} style={{
              display: "grid", gridTemplateColumns: "1fr 100px 100px 120px 120px 140px",
              gap: 12, padding: "14px 24px", alignItems: "center",
              borderTop: i > 0 ? "1px solid var(--cc-border)" : undefined,
            }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}>{inv.creatorId.slice(0, 8)}...</span>
              <Badge variant="neutral" style={{ fontSize: 11 }}>{inv.channel}</Badge>
              <Badge variant={STATUS_BADGE[inv.status] ?? "neutral"}>{inv.status}</Badge>
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{inv.sentAt ? formatDateAbs(inv.sentAt) : "—"}</span>
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{inv.respondedAt ? formatDateAbs(inv.respondedAt) : "—"}</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => copyLink(inv.inviteToken)} title="Copy link" style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--cc-border)", background: "var(--cc-card)", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 2, color: "var(--cc-text-muted)" }}>
                  <Copy size={12} /> {copied === inv.inviteToken ? "Copied!" : "Link"}
                </button>
                {inv.status === "PENDING" && (
                  <>
                    <button onClick={() => handleAction(inv.id, "RESEND")} style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--cc-border)", background: "var(--cc-card)", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 2, color: "var(--cc-text-muted)" }}>
                      <RotateCcw size={12} /> Resend
                    </button>
                    <button onClick={() => handleAction(inv.id, "CANCEL")} style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--cc-danger)", background: "color-mix(in srgb, var(--cc-danger) 14%, transparent)", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 2, color: "var(--cc-danger)" }}>
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
        <Modal open={true} onClose={() => setShowCreate(false)} title="Invite Creator" size={draft ? "lg" : "md"} footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "space-between", width: "100%" }}>
            <Button variant="ghost" loading={drafting} onClick={handleDraft} disabled={!form.creatorId}>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}><Sparkles size={14} /> Draft with AI</span>
            </Button>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button variant="primary" loading={submitting} onClick={handleCreate} disabled={!form.creatorId}>Send Invite</Button>
            </div>
          </div>
        }>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Creator</label>
              <CreatorSelect
                value={form.creatorId}
                onChange={(id) => { setForm(f => ({ ...f, creatorId: id })); setDraft(null); setDraftError(null); }}
              />
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Channel</label>
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
            {draftError && (
              <div role="alert" style={{ padding: "10px 14px", borderRadius: 10, border: "1px solid var(--cc-danger)", background: "color-mix(in srgb, var(--cc-danger) 8%, transparent)", fontSize: 13, color: "var(--cc-danger)" }}>
                {draftError}
              </div>
            )}
            {draft && (
              <OutreachDraftPanel
                subject={draft.subject}
                body={draft.body}
                groundedFacts={draft.groundedFacts}
                grounding={draft.grounding ?? undefined}
                channel={form.channel}
              />
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
