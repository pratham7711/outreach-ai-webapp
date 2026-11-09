"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Mail, Users, Clock, User, Link as LinkIcon, Check, UserMinus, UserPlus, AlertCircle, Trash2 } from "lucide-react";
import { Avatar, Input } from "@pratham7711/ui";
import { Modal, ModalNotice } from "@/components/ds/Modal";
import {
  PageHeader,
  Dropdown,
  Button,
  useConfirm,
  Field,
  SectionCard,
  DataTable,
  MetricTile,
  MoreMenu,
  NoResults,
  StatusBadge,
  type DataTableColumn,
} from "@/components/ds";
import { enumLabel } from "@/lib/ui/enumLabel";
import { action } from "@/lib/ui/actions";

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

/* Roles are not statuses, so they take the neutral badge; an invite's state
   is one, so it takes its status tone (pending warns, expired is danger). */
const roleLabel = (role: string) => enumLabel(role);

type Seats = { used: number; pending: number; max: number | null };

export default function TeamClient({
  users, invites, seats, canManage = false, currentUserId = null, viewerRole = null,
}: {
  users: User[];
  invites: Invite[];
  seats?: Seats;
  /* users:manage, decided on the server. Everything that mints, reveals or
     revokes access hangs off this — the invite form, the invite tokens behind
     the copy-link button, and the per-member role and remove controls. A
     member without it gets the roster and nothing else. */
  canManage?: boolean;
  currentUserId?: string | null;
  viewerRole?: string | null;
}) {
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
  const confirm = useConfirm();
  const [busyUserId, setBusyUserId] = useState<string | null>(null);

  /* Only an owner may hand out or take back OWNER, and the API enforces it —
     offering the option to an admin would just produce a 403 they cannot act
     on. The list is otherwise every role an invite can be issued at. */
  const assignableRoles: readonly string[] =
    viewerRole === "OWNER" ? ["OWNER", ...ROLE_OPTIONS] : ROLE_OPTIONS;
  const activeOwners = users.filter((u) => u.role === "OWNER" && u.isActive).length;

  /** Why this row's controls are locked, or null if they are not. */
  function lockedReason(user: User): string | null {
    if (user.id === currentUserId) return "You cannot change your own role or remove yourself.";
    if (user.role === "OWNER" && viewerRole !== "OWNER") return "Only an owner can change another owner.";
    if (user.role === "OWNER" && activeOwners <= 1) return "This is the last owner of the workspace.";
    return null;
  }

  async function handleRoleChange(user: User, role: string) {
    if (role === user.role) return;
    setNotice(null);
    setBusyUserId(user.id);
    try {
      const res = await fetch(`/api/team/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data?.error ?? "Could not change that role.");
        return;
      }
      setNotice(`${user.name || user.email} is now ${role.toLowerCase()}.`);
      router.refresh();
    } catch {
      setNotice("Network error while changing the role.");
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleRemove(user: User) {
    const ok = await confirm({
      verb: "remove",
      subject: user.name || user.email,
      icon: UserMinus,
      description:
        "They lose access within a minute, and cannot sign in again. Their campaigns, comments and history stay exactly where they are — nothing is deleted. An owner or admin can restore the account later.",
      confirmLabel: "Remove from workspace",
    });
    if (!ok) return;
    setNotice(null);
    setBusyUserId(user.id);
    try {
      const res = await fetch(`/api/team/${user.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(data?.error ?? "Could not remove that member.");
        return;
      }
      setNotice(`${user.name || user.email} no longer has access.`);
      router.refresh();
    } catch {
      setNotice("Network error while removing the member.");
    } finally {
      setBusyUserId(null);
    }
  }

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

  const seatTitle = seats
    ? `${seats.used} member${seats.used === 1 ? "" : "s"}${seats.pending ? ` and ${seats.pending} pending invite${seats.pending === 1 ? "" : "s"}` : ""}${seatLimit != null ? ` of ${seatLimit} seats` : ""}`
    : undefined;
  /* No denominator when there is no cap. Dropping the counter entirely would
     lose the useful half -- how many people are in the workspace is worth
     showing whether or not it is limited. */
  const seatText = seats
    ? seatLimit != null
      ? `${seatsUsed} of ${seatLimit} seats used`
      : `${seatsUsed} seat${seatsUsed === 1 ? "" : "s"} in use`
    : null;
  const openInvites = pendingInvites.filter((i) => i.status === "pending").length;

  const memberColumns: DataTableColumn<User>[] = [
    {
      key: "name",
      header: "Name",
      minWidth: 200,
      render: (user) => (
        <span className="cc-team-member">
          <Avatar name={user.name} src={user.avatarUrl ?? undefined} size="sm" />
          <span className="cc-dt-truncate cc-team-member__name">{user.name}</span>
          {!user.isActive ? <StatusBadge tone="neutral">Removed</StatusBadge> : null}
        </span>
      ),
    },
    {
      key: "email",
      header: "Email",
      minWidth: 200,
      truncate: (user) => user.email,
      render: (user) => <span className="cc-team-muted">{user.email}</span>,
    },
    {
      key: "role",
      header: "Role",
      width: canManage ? 160 : 120,
      render: (user) => {
        const locked = canManage ? lockedReason(user) : "read-only";
        /* A manager gets the role as a control; everyone else gets it as a
           label, because /api/team refuses them anyway. */
        return canManage && !locked && user.isActive ? (
          <Dropdown
            ariaLabel={`Role for ${user.name || user.email}`}
            align="left"
            fullWidth
            disabled={busyUserId === user.id}
            value={user.role}
            onChange={(role) => handleRoleChange(user, role)}
            options={assignableRoles.map((r) => ({ value: r, label: roleLabel(r) }))}
          />
        ) : (
          <StatusBadge tone="neutral" title={canManage && locked !== "read-only" ? locked ?? undefined : undefined}>
            {roleLabel(user.role)}
          </StatusBadge>
        );
      },
    },
    {
      key: "last",
      header: "Last sign-in",
      width: 140,
      render: (user) => <span className="cc-team-muted">{formatDate(user.lastLoginAt)}</span>,
    },
    ...(canManage
      ? [
          {
            key: "actions",
            header: "Actions",
            hideHeader: true,
            width: 64,
            align: "right" as const,
            render: (user: User) => {
              const locked = lockedReason(user);
              const busy = busyUserId === user.id;
              return user.isActive && !locked ? (
                <MoreMenu
                  label={`More actions for ${user.name || user.email}`}
                  size="sm"
                  items={[
                    {
                      label: "Remove from workspace",
                      icon: <UserMinus size={16} aria-hidden="true" />,
                      danger: true,
                      disabled: busy,
                      onClick: () => void handleRemove(user),
                    },
                  ]}
                />
              ) : (
                <span className="cc-team-muted" title={locked ?? undefined}>
                  {user.isActive ? "—" : "No access"}
                </span>
              );
            },
          },
        ]
      : []),
  ];

  const inviteColumns: DataTableColumn<Invite>[] = [
    {
      key: "email",
      header: "Email",
      minWidth: 220,
      truncate: (invite) => invite.email,
      render: (invite) => invite.email,
    },
    { key: "role", header: "Role", width: 120, render: (invite) => <StatusBadge tone="neutral">{roleLabel(invite.role)}</StatusBadge> },
    { key: "sent", header: "Sent", width: 130, render: (invite) => <span className="cc-team-muted">{formatDate(invite.createdAt)}</span> },
    { key: "expires", header: "Expires", width: 130, render: (invite) => <span className="cc-team-muted">{formatDate(invite.expiresAt)}</span> },
    {
      key: "status",
      header: "Status",
      width: 120,
      render: (invite) => <StatusBadge tone={invite.status === "expired" ? "danger" : invite.status === "pending" ? "warning" : "success"}>{enumLabel(invite.status)}</StatusBadge>,
    },
    {
      key: "actions",
      header: "Actions",
      hideHeader: true,
      width: 220,
      align: "right",
      render: (invite) => (
        <span className="cc-team-actions">
          {invite.status === "pending" ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                disabled={resendingId === invite.id}
                aria-label={`Resend invite email to ${invite.email}`}
                title="Send the invite email again"
                iconLeft={resentId === invite.id ? <Check size={16} aria-hidden="true" /> : <Mail size={16} aria-hidden="true" />}
                onClick={() => handleResend(invite.id, invite.email)}
              >
                {resentId === invite.id ? "Sent" : resendingId === invite.id ? "Sending" : "Resend"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                aria-label={`Copy invite link for ${invite.email}`}
                title="Copy invite link"
                iconLeft={copiedToken === invite.token ? <Check size={16} aria-hidden="true" /> : <LinkIcon size={16} aria-hidden="true" />}
                onClick={() => copyInviteLink(invite.token)}
              >
                {copiedToken === invite.token ? "Copied" : "Link"}
              </Button>
            </>
          ) : null}
          <MoreMenu
            label={`More actions for the invite to ${invite.email}`}
            size="sm"
            items={[{ label: "Cancel invite", icon: <Trash2 size={16} aria-hidden="true" />, danger: true, onClick: () => void handleCancel(invite.id) }]}
          />
        </span>
      ),
    },
  ];

  return (
    <div className="rsp-page page-enter">
      <PageHeader
        title="Team"
        subtitle={
          <>
            Manage your team and invite new members
            {seatText ? (
              <>
                {" · "}
                <span className={seatsFull ? "cc-team-seats-full" : undefined} title={seatTitle}>
                  {seatText}
                </span>
              </>
            ) : null}
          </>
        }
        actions={
          canManage ? (
            <Button
              variant="primary"
              iconLeft={<Plus size={16} aria-hidden="true" />}
              size="sm"
              disabled={seatsFull}
              title={seatsFull ? "All seats are in use or invited" : undefined}
              onClick={() => setShowModal(true)}
              {...action("invite-member")}
            >
              Invite member
            </Button>
          ) : null
        }
      />

      <div className="cc-team-stack">
        <div className="cc-tiles-balanced">
          <MetricTile label="Team members" value={users.length.toLocaleString("en-US")} icon={Users} />
          <MetricTile label="Pending invites" value={openInvites.toLocaleString("en-US")} icon={Clock} />
        </div>

        {/* Whether the mail actually left is the one thing the person clicking
            Invite cannot see for themselves, so it is said here rather than
            assumed. Dismissible: it is confirmation, not an error to be cleared
            by reloading. */}
        {notice && (
          <div role="status" className="cc-team-notice">
            <span>{notice}</span>
            <Button variant="ghost" size="sm" onClick={() => setNotice(null)}>
              Dismiss
            </Button>
          </div>
        )}

        <SectionCard icon={Users} title="Members" padded={false}>
          <DataTable
            bare
            caption="Team members"
            columns={memberColumns}
            rows={users}
            rowKey={(user) => user.id}
            empty={
              <NoResults
                icon={<User size={32} strokeWidth={1.75} />}
                title="No team members"
                description="Invite your first team member."
              />
            }
          />
        </SectionCard>

        {/* Manager-only: the rows carry `token`, which is the whole credential
            -- the accept endpoint checks the token and never the address it
            was mailed to. The server does not even load them for anyone else,
            so this is belt and braces. */}
        {canManage && pendingInvites.length > 0 && (
          <SectionCard icon={Mail} title="Pending invites" padded={false}>
            <DataTable
              bare
              caption="Pending invites"
              columns={inviteColumns}
              rows={pendingInvites}
              rowKey={(invite) => invite.id}
            />
          </SectionCard>
        )}
      </div>

      {/* Invite Modal */}
      <Modal
        open={canManage && showModal}
        onClose={() => { setShowModal(false); setError(null); }}
        icon={UserPlus}
        title="Invite team member"
        description="We email them a link to join, which you can also copy from Pending Invites."
        size="sm"
        dismissible={false}
        footer={
          <div className="cc-modal-footer">
            <Button type="button" variant="secondary" size="sm" onClick={() => { setShowModal(false); setError(null); }}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="cc-invite-form"
              variant="primary"
              size="sm"
              disabled={loading || !inviteEmail}
              iconLeft={<Mail size={16} aria-hidden="true" />}
            >
              {loading ? "Sending…" : "Send invite"}
            </Button>
          </div>
        }
      >
        {/* A form, so Enter in the address field sends the invite, and a
            label tied to the input by id, so the field has a name. Both were
            missing: the label was free-standing text and Enter did nothing. */}
        <form
          id="cc-invite-form"
          className="cc-dialog-stack"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!loading && inviteEmail) void handleInvite();
          }}
        >
          <Field label="Email address" required>
            <Input
              id="cc-invite-email"
              type="email"
              placeholder="colleague@company.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              iconLeft={<Mail size={16} aria-hidden="true" />}
              autoComplete="off"
              autoFocus
            />
          </Field>
          <Field label="Role">
            <Dropdown
              id="cc-invite-role"
              align="left"
              fullWidth
              value={inviteRole}
              onChange={setInviteRole}
              options={ROLE_OPTIONS.map((r) => ({ value: r, label: roleLabel(r) }))}
            />
          </Field>
          {seatLimit != null ? (
            <p className="cc-dialog-meta">
              <span>{seatsUsed}/{seatLimit} seats in use, pending invites included</span>
            </p>
          ) : null}
          {error && (
            <ModalNotice tone="danger" icon={AlertCircle}>
              {error}
            </ModalNotice>
          )}
        </form>
      </Modal>
    </div>
  );
}
