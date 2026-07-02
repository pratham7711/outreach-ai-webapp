"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Button, Modal, EmptyState, Skeleton } from "@pratham7711/ui";
import { Send, Copy, RotateCcw, X } from "lucide-react";

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

type Creator = { id: string; name: string; handle: string };

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
  const [creators, setCreators] = useState<Creator[]>([]);
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

  const openCreate = async () => {
    setShowCreate(true);
    if (creators.length === 0) {
      const res = await fetch("/api/creators");
      if (res.ok) {
        const data = await res.json();
        setCreators((data.creators ?? data).map((c: any) => ({ id: c.id, name: c.name, handle: c.handle })));
      }
    }
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

  const selectStyle = {
    width: "100%",
    padding: "10px 14px",
    borderRadius: 10,
    border: "1px solid var(--cc-border)",
    fontSize: 14,
    color: "var(--cc-text)",
    background: "white",
    outline: "none",
    boxSizing: "border-box" as const,
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
          <EmptyState icon="✉️" title="No invites sent" description="Invite creators to join this campaign." />
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
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{inv.sentAt ? new Date(inv.sentAt).toLocaleDateString() : "—"}</span>
              <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{inv.respondedAt ? new Date(inv.respondedAt).toLocaleDateString() : "—"}</span>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={() => copyLink(inv.inviteToken)} title="Copy link" style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--cc-border)", background: "white", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 2, color: "var(--cc-text-muted)" }}>
                  <Copy size={12} /> {copied === inv.inviteToken ? "Copied!" : "Link"}
                </button>
                {inv.status === "PENDING" && (
                  <>
                    <button onClick={() => handleAction(inv.id, "RESEND")} style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid var(--cc-border)", background: "white", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 2, color: "var(--cc-text-muted)" }}>
                      <RotateCcw size={12} /> Resend
                    </button>
                    <button onClick={() => handleAction(inv.id, "CANCEL")} style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #DC2626", background: "#FEE2E2", cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", gap: 2, color: "#DC2626" }}>
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
        <Modal open={true} onClose={() => setShowCreate(false)} title="Invite Creator" size="md" footer={
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button variant="secondary" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button variant="primary" loading={submitting} onClick={handleCreate} disabled={!form.creatorId}>Send Invite</Button>
          </div>
        }>
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Creator</label>
              <select value={form.creatorId} onChange={(e) => setForm(f => ({ ...f, creatorId: e.target.value }))} style={selectStyle}>
                <option value="">Select creator...</option>
                {creators.map(c => <option key={c.id} value={c.id}>{c.name} (@{c.handle})</option>)}
              </select>
            </div>
            <div>
              <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6 }}>Channel</label>
              <select value={form.channel} onChange={(e) => setForm(f => ({ ...f, channel: e.target.value }))} style={selectStyle}>
                <option value="LINK">Shareable Link</option>
                <option value="INSTAGRAM_DM">Instagram DM</option>
              </select>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
