import { db } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";
import { getOrgEntitlements } from "@/lib/entitlements";

export type TeamMemberRow = {
  id: string;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  lastLoginAt: string | null;
  isActive: boolean;
};

export type TeamInviteRow = {
  id: string;
  email: string;
  role: string;
  /** The invite credential. Present only for a viewer with users:manage. */
  token: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  status: "pending" | "accepted" | "expired";
};

export type TeamPageData = {
  users: TeamMemberRow[];
  invites: TeamInviteRow[];
  seats: { used: number; pending: number; max: number | null };
  canManage: boolean;
};

/**
 * Everything the Team screen renders, gated the same way /api/invites is.
 *
 * The page used to load `db.userInvite.findMany` with no select and hand the
 * rows straight to a client component, so every pending invite's `token`
 * reached the browser of every signed-in member. The accept endpoint checks the
 * token and never the address it was mailed to, so a VIEWER reading their own
 * page source could accept an invitation issued at OWNER. The API had always
 * refused them that list; only the server component skipped the check.
 */
export async function loadTeamPageData(params: {
  orgId: string;
  role: string | null | undefined;
}): Promise<TeamPageData> {
  const { orgId } = params;
  const canManage = !!params.role && hasPermission(params.role, "users:manage");

  const now = new Date();

  const [users, invites] = await Promise.all([
    db.user.findMany({
      where: { orgId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        avatarUrl: true,
        lastLoginAt: true,
        isActive: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    canManage
      ? db.userInvite.findMany({
          where: { orgId },
          select: {
            id: true,
            email: true,
            role: true,
            token: true,
            createdAt: true,
            expiresAt: true,
            acceptedAt: true,
          },
          orderBy: { createdAt: "desc" },
        })
      : Promise.resolve([] as never[]),
  ]);

  const enrichedInvites: TeamInviteRow[] = invites.map((invite: any) => ({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    token: invite.token,
    createdAt: new Date(invite.createdAt).toISOString(),
    expiresAt: new Date(invite.expiresAt).toISOString(),
    acceptedAt: invite.acceptedAt ? new Date(invite.acceptedAt).toISOString() : null,
    status: invite.acceptedAt
      ? ("accepted" as const)
      : new Date(invite.expiresAt) < now
        ? ("expired" as const)
        : ("pending" as const),
  }));

  const serializedUsers: TeamMemberRow[] = users.map((u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    avatarUrl: u.avatarUrl ?? null,
    lastLoginAt: u.lastLoginAt ? new Date(u.lastLoginAt).toISOString() : null,
    isActive: u.isActive,
  }));

  /* Seats are shown as n/N because the limit is enforced at invite time — a
     refusal the user could not have seen coming is a worse experience than the
     limit itself. Pending invites count, since each has already promised
     someone a seat. A viewer who cannot read the invite rows still gets the
     number, from a COUNT that returns no tokens. */
  const entitlements = await getOrgEntitlements(orgId);
  const pending = canManage
    ? enrichedInvites.filter((i) => i.status === "pending").length
    : await db.userInvite.count({
        where: { orgId, acceptedAt: null, expiresAt: { gt: now } },
      });

  return {
    users: serializedUsers,
    invites: enrichedInvites,
    seats: {
      used: serializedUsers.length,
      pending,
      max: entitlements?.limits.maxUsers ?? null,
    },
    canManage,
  };
}
