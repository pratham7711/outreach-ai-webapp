"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Mail, Trash2, Users, Clock, User } from "lucide-react";
import { Button, Card, Badge, Avatar, EmptyState, Modal, Input } from "@pratham7711/ui";

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

export default function TeamClient({ users, invites }: { users: User[]; invites: Invite[] }) {
  const router = useRouter();
  const [showModal, setShowModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<string>("MEMBER");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pendingInvites = invites.filter((i) => i.status !== "accepted");

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

  async function handleCancel(id: string) {
    try {
      const res = await fetch(`/api/invites/${id}`, { method: "DELETE" });
      if (res.ok) {
        router.refresh();
      }
    } catch {
      // silent
    }
  }

  function formatDate(iso: string | null) {
    if (!iso) return "Never";
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div className="rsp-page page-enter">
      {/* Header */}
      <div className="rsp-header">
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--cc-text)", letterSpacing: "-0.02em", marginBottom: 4 }}>
            Team Members
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            Manage your team and invite new members
          </p>
        </div>
        <Button variant="primary" iconLeft={<Plus size={15} />} size="sm" onClick={() => setShowModal(true)}>
          Invite Member
        </Button>
      </div>

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

      {/* Pending Invites Table */}
      {pendingInvites.length > 0 && (
        <Card variant="solid" noPadding>
          <div style={{ padding: "14px 24px", borderBottom: "1px solid var(--cc-border)", background: "var(--cc-hover-bg)" }}>
            <span style={{ fontWeight: 700, fontSize: 14, color: "var(--cc-text)" }}>Pending Invites</span>
          </div>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <div style={{ minWidth: 640 }}>
            {/* Table header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "1fr 100px 120px 120px 80px 60px",
              padding: "10px 24px",
              borderBottom: "1px solid var(--cc-border)",
              gap: 16,
            }}>
              {["Email", "Role", "Sent", "Expires", "Status", ""].map((h) => (
                <span key={h} style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "var(--cc-text-muted)" }}>
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
                  className="cc-table-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 100px 120px 120px 80px 60px",
                    padding: "12px 24px",
                    alignItems: "center",
                    borderBottom: "1px solid var(--cc-border)",
                    gap: 16,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Mail size={14} style={{ color: "var(--cc-text-muted)", flexShrink: 0 }} />
                    <span style={{ fontSize: 13, color: "var(--cc-text)" }}>{invite.email}</span>
                  </div>
                  <Badge style={{ background: roleStyle.bg, color: roleStyle.color, fontSize: 11, fontWeight: 600 }}>
                    {invite.role}
                  </Badge>
                  <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{formatDate(invite.createdAt)}</span>
                  <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{formatDate(invite.expiresAt)}</span>
                  <Badge style={{ background: statusStyle.bg, color: statusStyle.color, fontSize: 10, fontWeight: 600, textTransform: "capitalize" }}>
                    {invite.status}
                  </Badge>
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
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value)}
              style={{
                width: "100%",
                padding: "9px 12px",
                borderRadius: 8,
                border: "1px solid var(--cc-border)",
                fontSize: 14,
                color: "var(--cc-text)",
                background: "var(--cc-card)",
                cursor: "pointer",
                outline: "none",
              }}
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r} value={r}>{r.charAt(0) + r.slice(1).toLowerCase()}</option>
              ))}
            </select>
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
