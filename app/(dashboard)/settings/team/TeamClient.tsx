"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Mail, Trash2, Users, Clock, User, Link as LinkIcon, Check } from "lucide-react";
import { Card, Badge, Avatar, EmptyState, Modal, Input } from "@pratham7711/ui";
import { PageHeader, Dropdown, Button } from "@/components/ds";

type User = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  isActive: boolean;
};

type Invite = {
  id: string;
  email: string;
  role: string;
  token: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  status: "pending" | "accepted" | "expired";
};

const ROLE_OPTIONS = ["ADMIN", "MANAGER", "MEMBER", "VIEWER"] as const;

const ROLE_COLORS: Record<string, { bg: string; color: string }> = {
  OWNER:   { bg: "#FEF3C7", color: "#D97706" },
  ADMIN:   { bg: "#EEF2FF", color: "#4F46E5" },
  MANAGER: { bg: "#D1FAE5", color: "#059669" },
  MEMBER:  { bg: "#F3F4F6", color: "#374151" },
  VIEWER:  { bg: "#FEE2E2", color: "#DC2626" },
};

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  pending:  { bg: "#FEF3C7", color: "#D97706" },
  accepted: { bg: "#D1FAE5", color: "#059669" },
  expired:  { bg: "#FEE2E2", color: "#DC2626" },
};

type Seats = { used: number; pending: number; max: number | null };

export default function TeamClient({
  users, invites, seats,
}: { users: User[]; invites: Invite[]; seats?: Seats }) {
  /* Infinity is a number, so `max != null` was true once seats were uncapped
     and the header rendered "3/Infinity seats" with the Invite button still
     live. A limit only exists if it is finite. */
  const seatLimit =
    seats?.max != null && Number.isFinite(seats.max) ? seats.max : null;
  const seatsUsed = seats ? seats.used + seats.pending : 0;
  const seatsFull = seatLimit != null && seatsUsed >= seatLimit;
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("MEMBER");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingInvites = invites.filter((i) => i.status !== "accepted");
  const [copiedToken, setCopiedToken] = useState<string | null>(null);
  const [resendingId, setResendingId] = useState<string | null>(null);
  const [resentId, setResentId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /* An invite is emailed on creation now, so this is the fallback rather than
     the delivery mechanism: it covers a provider outage, an invite created
     before the mail path existed, and the case where someone simply wants to
     paste the link into a DM. */
  const copyInviteLink = async (token: string) => {
    const url = `${window.location.origin}/accept-invite?token=${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this invite link:", url);
    }
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  };

  async function handleInvite() {
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Failed to send invite");
        return;
      }
      /* Say which of the two things happened. "Invite sent" when nothing was
         sent is the failure the copy-link button existed to work around, and
         silently succeeding would put us straight back there. */
      const data = await res.json().catch(() => ({}));
      setNotice(
        data?.emailed
          ? `Invite emailed to ${inviteEmail}.`
          : `Invite created for ${inviteEmail}, but the email could not be sent. Use Link to copy it and send it yourself.`
      );
      setShowModal(false);
      setInviteEmail("");
      setInviteRole("MEMBER");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setLoading(false);
    }
  }

  async function handleResend(id: string, email: string) {
    setNotice(null);
    setResendingId(id);
    try {
      const res = await fetch(`/api/invites/${id}/resend`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data?.error ?? "Could not resend the invite.");
        return;
      }
      setResentId(id);
      setNotice(`Invite re-sent to ${email}.`);
      setTimeout(() => setResentId(null), 2500);
    } catch {
      setNotice("Network error while resending.");
    } finally {
      setResendingId(null);
    }
  }

  async function handleCancel(id: string) {
    try {
      const res = await fetch(`/api/invites/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
        return;
      }
      // The invite row stayed put with nothing said, which reads as a click
      // that never registered.
      setNotice("Couldn't cancel that invite. It is still open.");
    } catch {
      setNotice("Network error while cancelling the invite.");
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return "Never";
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      // Named, so the server render and the browser's cannot land on different
      // days for an invite sent near midnight. See lib/format.
      timeZone: "UTC",
    });
  }

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Team Members"
        subtitle="Manage your team and invite new members"
        actions={
          <>
          {seats ? (
            <span
              style={{ fontSize: 13, color: seatsFull ? "var(--cc-warning)" : "var(--cc-text-muted)" }}
              title={`${seats.used} member${seats.used === 1 ? "" : "s"}${seats.pending ? ` and ${seats.pending} pending invite${seats.pending === 1 ? "" : "s"}` : ""}${seatLimit != null ? ` of ${seatLimit} seats` : ""}`}
            >
              {/* No denominator when there is no cap. Dropping the counter
                  entirely would lose the useful half -- how many people are in
                  the workspace is worth showing whether or not it is limited. */}
              {seatLimit != null ? `${seatsUsed}/${seatLimit} seats` : `${seatsUsed} seat${seatsUsed === 1 ? "" : "s"} in use`}
            </span>
          ) : null}
          <Button
            variant="primary"
            iconLeft={<Plus size={15} />}
            size="sm"
            disabled={seatsFull}
            title={seatsFull ? "All seats are in use or invited" : undefined}
            onClick={() => setShowModal(true)}
          >
            Invite Member
          </Button>
          </>
        }
      />

      {/* Stats */}
      <div className="cc-stagger grid grid-cols-1 sm:grid-cols-2" style={{ gap: 20, marginBottom: 32, maxWidth: 480 }}>
        <Card variant="solid" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "var(--cc-primary)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Users size={18} style={{ color: "#fff" }} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--cc-text)" }}>{users.length}</div>
              <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>Team Members</div>
            </div>
          </div>
        </Card>
        <Card variant="solid" style={{ padding: "20px 24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 40, height: 40, borderRadius: 10, background: "#D97706", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Clock size={18} style={{ color: "#fff" }} />
            </div>
            <div>
              <div style={{ fontSize: 22, fontWeight: 800, color: "var(--cc-text)" }}>{pendingInvites.filter((i) => i.status === "pending").length}</div>
              <div style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>Pending Invites</div>
            </div>
          </div>
        </Card>
      </div>

      {/* Members Table */}
      <Card variant="solid" noPadding style={{ marginBottom: 32 }}>
        <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-hover-bg)" }}>
          <span style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>Members</span>
        </div>
        {users.length === 0 ? (
          <div style={{ padding: "48px 24px" }}>
            <EmptyState
              icon={<User size={32} color="var(--cc-text-subtle)" />}
              title="No team members"
              description="Invite your first team member"
            />
          </div>
        ) : (
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <div style={{ minWidth: 560 }}>
            {/* Table header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 120px 140px",
              padding: "10px 24px",
              borderBottom: "1px solid var(--cc-border)",
              gap: 16,
            }}>
              {["Name", "Email", "Role", "Last Login"].map((h) => (
                <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--cc-text-muted)" }}>
                  {h}
                </span>
              ))}
            </div>
            {users.map((user) => {
              const roleStyle = ROLE_COLORS[user.role] ?? ROLE_COLORS.MEMBER;
              return (
                <div
                  key={user.id}
                  className="cc-table-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr 120px 140px",
                    padding: "12px 24px",
                    alignItems: "center",
                    borderBottom: "1px solid var(--cc-border)",
                    gap: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <Avatar name={user.name} src={user.avatarUrl ?? undefined} size="sm" />
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>{user.name}</span>
                  </div>
                  <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{user.email}</span>
                  <Badge style={{ background: roleStyle.bg, color: roleStyle.color, fontSize: 11, fontWeight: 600 }}>
                    {user.role}
                  </Badge>
                  <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                    {formatDate(user.lastLoginAt)}
                  </span>
                </div>
              );
            })}
            </div>
          </div>
        )}
      </Card>

      {/* Whether the mail actually left is the one thing the person clicking
          Invite cannot see for themselves, so it is said here rather than
          assumed. Dismissible: it is confirmation, not an error to be cleared
          by reloading. */}
      {notice && (
        <div
          role="status"
          style={{
            display: "flex", alignItems: "center", justifyContent: "space-between",
            gap: 12, margin: "0 0 16px", padding: "10px 14px",
            background: "var(--cc-card)", border: "1px solid var(--cc-border)",
            borderRadius: 8, fontSize: 13, color: "var(--cc-text)",
          }}
        >
          <span>{notice}</span>
          <button
            onClick={() => setNotice(null)}
            aria-label="Dismiss"
            style={{ background: "none", border: "none", cursor: "pointer", color: "var(--cc-text-muted)", fontSize: 13, fontWeight: 600 }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Pending Invites Table */}
      {pendingInvites.length > 0 && (
        <Card variant="solid" noPadding>
          <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-hover-bg)" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>Pending Invites</span>
          </div>
          <div className="rsp-invites-scroll">
            <div className="rsp-invites-inner">
            {/* Table header. Hidden below 768px, where each invite becomes a
                stacked card and column headings have nothing to head. */}
            <div
              className="rsp-invites-head"
              style={{ borderBottom: "1px solid var(--cc-border)" }}
            >
              {/* One entry per grid column; the three trailing blanks are the
                  Link, Resend and Cancel action cells. Indexed keys because
                  several labels are empty and would collide as keys. */}
              {["Email", "Role", "Sent", "Expires", "Status", "", "", ""].map((h, i) => (
                <span key={i} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--cc-text-muted)" }}>
                  {h}
                </span>
              ))}
            </div>
            {pendingInvites.map((invite) => {
              const roleStyle = ROLE_COLORS[invite.role] ?? ROLE_COLORS.MEMBER;
              const statusStyle = STATUS_COLORS[invite.status] ?? STATUS_COLORS.pending;
              return (
                <div
                  key={invite.id}
                  className="cc-table-row rsp-invites-row"
                  style={{ borderBottom: "1px solid var(--cc-border)" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Mail size={14} style={{ color: "var(--cc-text-muted)", flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: "var(--cc-text)" }}>{invite.email}</span>
                  </div>
                  <Badge style={{ background: roleStyle.bg, color: roleStyle.color, fontSize: 11, fontWeight: 600 }}>
                    {invite.role}
                  </Badge>
                  {/* Stacked on a phone these are two bare dates in a column
                      with nothing to tell them apart; the column headings that
                      did that job are hidden at this width. */}
                  <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                    <span className="rsp-only-mobile">Sent </span>{formatDate(invite.createdAt)}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                    <span className="rsp-only-mobile">Expires </span>{formatDate(invite.expiresAt)}
                  </span>
                  <Badge style={{ background: statusStyle.bg, color: statusStyle.color, fontSize: 10, fontWeight: 600, textTransform: "capitalize" }}>
                    {invite.status}
                  </Badge>
                  {/* Wrapped so the three actions can become their own row on a
                      phone; display:contents puts them back in the grid at
                      768px. */}
                  <div className="rsp-invites-actions">
                  {invite.status === "pending" ? (
                    <button
                      onClick={() => copyInviteLink(invite.token)}
                      aria-label={`Copy invite link for ${invite.email}`}
                      title="Copy invite link"
                      style={{
                        background: "none", border: "none", cursor: "pointer",
                        color: copiedToken === invite.token ? "var(--cc-success)" : "var(--cc-primary)",
                        padding: 4, borderRadius: 6, display: "flex", alignItems: "center",
                        fontSize: 12, fontWeight: 600, gap: 4,
                      }}
                    >
                      {copiedToken === invite.token ? <Check size={14} /> : <LinkIcon size={14} />}
                      {copiedToken === invite.token ? "Copied" : "Link"}
                    </button>
                  ) : <span className="rsp-invites-spacer" />}
                  {invite.status === "pending" ? (
                    <button
                      onClick={() => handleResend(invite.id, invite.email)}
                      disabled={resendingId === invite.id}
                      aria-label={`Resend invite email to ${invite.email}`}
                      title="Send the invite email again"
                      style={{
                        background: "none", border: "none",
                        cursor: resendingId === invite.id ? "wait" : "pointer",
                        color: resentId === invite.id ? "var(--cc-success)" : "var(--cc-primary)",
                        padding: 4, borderRadius: 6, display: "flex", alignItems: "center",
                        fontSize: 12, fontWeight: 600, gap: 4,
                        opacity: resendingId === invite.id ? 0.6 : 1,
                      }}
                    >
                      {resentId === invite.id ? <Check size={14} /> : <Mail size={14} />}
                      {resentId === invite.id ? "Sent" : resendingId === invite.id ? "Sending" : "Resend"}
                    </button>
                  ) : <span className="rsp-invites-spacer" />}
                  <button
                    onClick={() => handleCancel(invite.id)}
                    aria-label="Cancel invite"
                    style={{
                      background: "none",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--cc-text-muted)",
                      padding: 4,
                      borderRadius: 6,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: "color 0.15s",
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = "#DC2626"; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = "var(--cc-text-muted)"; }}
                  >
                    <Trash2 size={15} />
                  </button>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
        </Card>
      )}

      {/* Invite Modal */}
      <Modal open={showModal} onClose={() => { setShowModal(false); setError(null); }} title="Invite Team Member">
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6, display: "block" }}>
              Email Address
            </label>
            <Input
              type="email"
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              iconLeft={<Mail size={15} />}
            />
          </div>
          <div>
            <label style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", marginBottom: 6, display: "block" }}>
              Role
            </label>
            <Dropdown
              ariaLabel="Role"
              align="left"
              fullWidth
              value={inviteRole}
              onChange={setInviteRole}
              options={ROLE_OPTIONS.map((r) => ({
                value: r,
                label: r.charAt(0) + r.slice(1).toLowerCase(),
              }))}
            />
          </div>
          {error && (
            <div style={{ fontSize: 13, color: "var(--cc-danger)", background: "color-mix(in srgb, var(--cc-danger) 14%, transparent)", padding: "8px 12px", borderRadius: 8 }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 8 }}>
            <Button variant="ghost" size="sm" onClick={() => { setShowModal(false); setError(null); }}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleInvite}
              disabled={loading || !inviteEmail}
              iconLeft={<Mail size={14} />}
            >
              {loading ? "Sending..." : "Send Invite"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
