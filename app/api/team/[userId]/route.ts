import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

/**
 * Changing and revoking a teammate's access.
 *
 * There was no route for either. Invites could be created, resent and
 * cancelled, but once somebody accepted one there was no way to demote them and
 * no way to take their access away — the Team screen listed members and offered
 * nothing to do about them, and `User.isActive` was written by nobody and read
 * by nobody. Firing an employee meant editing the database by hand.
 *
 * DELETE deactivates rather than deletes. A User owns audit rows, comments,
 * activity logs, documents and campaign memberships; removing the row would
 * either fail on a foreign key or take the history with it. isActive=false is
 * the revocation — lib/auth.ts refuses the login and the JWT callback drops a
 * live session within the minute.
 */

const VALID_ROLES = ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"] as const;
type Role = (typeof VALID_ROLES)[number];

/** Someone who can still sign in. A deactivated owner is not holding the org. */
function countActiveOwners(orgId: string) {
  return db.user.count({ where: { orgId, role: "OWNER", isActive: true } });
}

async function loadTarget(orgId: string, userId: string) {
  /* findFirst with the orgId in the WHERE rather than findUnique-then-compare:
     a miss and a cross-tenant hit come back identically, so the 404 does not
     tell a caller whether that id exists in somebody else's workspace. */
  return db.user.findFirst({
    where: { id: userId, orgId },
    select: { id: true, email: true, name: true, role: true, isActive: true },
  });
}

// PATCH /api/team/[userId] — change a member's role
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const gate = await requirePermission(request, "users:manage");
    if (!gate.ok) return gate.response;
    const { orgId } = gate.auth;
    const { userId } = await params;

    const body = await request.json().catch(() => null);
    const role = (body as any)?.role;
    if (!role || !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    const target = await loadTarget(orgId, userId);
    if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    /* Nobody edits their own role. An ADMIN promoting themselves to OWNER is
       the escalation this endpoint would otherwise hand out for free, and an
       OWNER demoting themselves is how an org ends up with no owner at all. */
    if (gate.auth.userId && target.id === gate.auth.userId) {
      return NextResponse.json(
        { error: "You cannot change your own role. Ask another owner." },
        { status: 400 }
      );
    }

    if (target.role === role) {
      return NextResponse.json({ id: target.id, role: target.role, unchanged: true });
    }

    /* Granting OWNER hands out the role that outranks you; revoking it takes
       away the role that outranks you. Both are the owner's call alone. An API
       key has no role to compare against, so it is held to the same rule --
       matching how /api/invites treats an OWNER invitation. */
    if ((role === "OWNER" || target.role === "OWNER") && gate.auth.role !== "OWNER") {
      return NextResponse.json(
        { error: "Only an owner can grant or revoke the owner role." },
        { status: 403 }
      );
    }

    /* An org with no owner cannot promote anyone back, because promoting to
       OWNER is owner-only. The last one is therefore a trap door, not an
       inconvenience. */
    if (target.role === "OWNER" && (role as Role) !== "OWNER") {
      const owners = await countActiveOwners(orgId);
      if (owners <= 1) {
        return NextResponse.json(
          {
            error:
              "This is the last owner of the workspace. Promote someone else to owner first.",
          },
          { status: 409 }
        );
      }
    }

    const updated = await db.user.update({
      where: { id: target.id },
      data: { role },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });

    await logAudit({
      orgId,
      ...getAuditActor(gate.auth),
      action: "user.role_change",
      entityType: "user",
      entityId: target.id,
      entityLabel: target.email,
      ipAddress: getRequestIp(request),
      before: { role: target.role },
      after: { role: updated.role },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to change member role:", error);
    return NextResponse.json({ error: "Failed to change member role" }, { status: 500 });
  }
}

// DELETE /api/team/[userId] — revoke a member's access (deactivate, never drop)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const gate = await requirePermission(request, "users:manage");
    if (!gate.ok) return gate.response;
    const { orgId } = gate.auth;
    const { userId } = await params;

    const target = await loadTarget(orgId, userId);
    if (!target) return NextResponse.json({ error: "Member not found" }, { status: 404 });

    if (gate.auth.userId && target.id === gate.auth.userId) {
      return NextResponse.json(
        { error: "You cannot remove yourself. Ask another owner or admin." },
        { status: 400 }
      );
    }

    if (target.role === "OWNER" && gate.auth.role !== "OWNER") {
      return NextResponse.json(
        { error: "Only an owner can remove another owner." },
        { status: 403 }
      );
    }

    if (target.role === "OWNER") {
      const owners = await countActiveOwners(orgId);
      if (owners <= 1) {
        return NextResponse.json(
          {
            error:
              "This is the last owner of the workspace. Promote someone else to owner first.",
          },
          { status: 409 }
        );
      }
    }

    if (!target.isActive) {
      return NextResponse.json({ id: target.id, isActive: false, unchanged: true });
    }

    const updated = await db.user.update({
      where: { id: target.id },
      data: { isActive: false },
      select: { id: true, email: true, name: true, role: true, isActive: true },
    });

    await logAudit({
      orgId,
      ...getAuditActor(gate.auth),
      action: "user.deactivate",
      entityType: "user",
      entityId: target.id,
      entityLabel: target.email,
      ipAddress: getRequestIp(request),
      before: { isActive: true, role: target.role },
      after: { isActive: false, role: target.role },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("Failed to remove member:", error);
    return NextResponse.json({ error: "Failed to remove member" }, { status: 500 });
  }
}
