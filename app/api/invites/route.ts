import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getOrgEntitlements } from "@/lib/entitlements";
import { getRequestIp } from "@/lib/request";
import { sendInviteEmail } from "@/lib/inviteEmail";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"] as const;

// GET /api/invites — List all invites for the org
/* Gated on users:manage rather than mere membership, because the rows carry
   `token`. That token is the entire credential: the accept endpoint checks it
   and never the address it was mailed to, so anyone who can read this list can
   accept any pending invite in the org -- including one issued at OWNER. */
export async function GET(request: NextRequest) {
  try {
    const gate = await requirePermission(request, "users:manage");
    if (!gate.ok) return gate.response;
    const { orgId } = gate.auth;

    const invites = await db.userInvite.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();
    const enriched = invites.map((invite) => ({
      ...invite,
      status: invite.acceptedAt
        ? "accepted"
        : new Date(invite.expiresAt) < now
          ? "expired"
          : "pending",
    }));

    return NextResponse.json({ invites: enriched });
  } catch (error) {
    console.error("Failed to fetch invites:", error);
    return NextResponse.json({ error: "Failed to fetch invites" }, { status: 500 });
  }
}

// POST /api/invites — Create a new invite
export async function POST(request: NextRequest) {
  try {
    /* Anyone signed in could previously invite anyone at any role. A VIEWER
       could mint an OWNER at an address they controlled, and the response body
       handed back the token, so the mail path was not even needed. rbac.ts had
       always said users:manage was OWNER/ADMIN only; this endpoint just never
       asked. */
    const gate = await requirePermission(request, "users:manage");
    if (!gate.ok) return gate.response;
    const { orgId } = gate.auth;

    const body = await request.json();
    const { email, role } = body;

    // Validate email
    if (!email || typeof email !== "string" || !EMAIL_REGEX.test(email)) {
      return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
    }

    // Validate role if provided
    if (role && !VALID_ROLES.includes(role)) {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    /* users:manage lets an ADMIN run the team, but handing out OWNER is not
       running the team -- it is granting the one role that outranks you, at an
       address of your choosing. An API key has no role to compare against, so
       it is held to the same rule. */
    if (role === "OWNER" && gate.auth.role !== "OWNER") {
      return NextResponse.json(
        { error: "Only an owner can invite another owner." },
        { status: 403 }
      );
    }

    /* Seats, counted before the invite is written.
       The reference shows this as "5/5" and refuses at the limit. Pending
       invites count against the total: an org one seat from full that sends
       three invitations has promised three people access it cannot grant, and
       whichever two accept last hit an error after choosing a password. Better
       to refuse the invitation than the acceptance. */
    const entitlements = await getOrgEntitlements(orgId);
    const maxUsers = entitlements?.limits.maxUsers ?? null;
    /* Seats are unlimited on every tier now (lib/plans.ts), so maxUsers is
       Infinity and this whole block is skipped. `>= Infinity` would be false
       anyway, but only after two COUNT queries had already run on a check that
       cannot refuse anything. The gate is kept rather than deleted because it
       is the enforcement point if a seat limit ever comes back -- and because
       an org whose planConfig is hand-edited to a finite number should still be
       held to it. */
    if (maxUsers !== null && Number.isFinite(maxUsers)) {
      const nowForSeats = new Date();
      const [members, pending] = await Promise.all([
        db.user.count({ where: { orgId } }),
        db.userInvite.count({
          where: { orgId, acceptedAt: null, expiresAt: { gt: nowForSeats } },
        }),
      ]);
      if (members + pending >= maxUsers) {
        return NextResponse.json(
          {
            error: `Your plan includes ${maxUsers} seat${maxUsers === 1 ? "" : "s"}, and ${members + pending} are in use or invited. Cancel a pending invite or remove a member to invite someone new.`,
            seats: { used: members, pending, max: maxUsers },
          },
          { status: 409 }
        );
      }
    }

    // Check for duplicate pending invite
    const now = new Date();
    const existing = await db.userInvite.findFirst({
      where: {
        orgId,
        email: email.toLowerCase(),
        acceptedAt: null,
        expiresAt: { gt: now },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "A pending invite already exists for this email" },
        { status: 409 }
      );
    }

    /* User.email is globally unique, so an address that already has an account
       -- in this org or any other -- can never accept an invitation: the accept
       endpoint 409s at the very end, after the invitee has typed a name and
       chosen a password. Nothing said so at invite time, so the row was
       written, the mail was sent, and the failure landed on the guest.
       Refuse here, where the person who can do something about it is looking. */
    const existingUser = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true },
    });
    if (existingUser) {
      return NextResponse.json(
        {
          error:
            "That email already belongs to an account; they must sign in with it.",
        },
        { status: 409 }
      );
    }

    const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const invite = await db.userInvite.create({
      data: {
        orgId,
        email: email.toLowerCase(),
        role: role ?? "MEMBER",
        expiresAt,
      },
    });

    await logAudit({
      orgId,
      ...getAuditActor(gate.auth),
      action: "invite.create",
      entityType: "user_invite",
      entityId: invite.id,
      entityLabel: invite.email,
      ipAddress: getRequestIp(request),
      after: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      },
    });

    /* The invite row is the source of truth; the mail is best-effort delivery
       of it. A provider outage must not lose an invitation that is already
       written and already audited, so a failed send is reported rather than
       thrown -- the Team screen falls back to "copy link" when emailed is
       false, which is exactly what everyone did before this existed. */
    const origin =
      process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const org = await db.organization.findUnique({
      where: { id: orgId },
      select: { name: true, brandName: true },
    });
    const sent = await sendInviteEmail({
      to: invite.email,
      orgName: org?.brandName || org?.name || "the team",
      role: invite.role,
      token: invite.token,
      origin,
      expiresAt: invite.expiresAt,
      invitedByEmail: gate.auth.actorEmail ?? null,
      kind: "invite",
      orgId,
      inviteId: invite.id,
    });

    /* The invite.create row above is written before the send, because the row
       is the thing that happened and it must survive a provider outage. That
       leaves the delivery unrecorded, though, and "invite created" reads like
       "invite delivered" to anyone scanning the log. A failed send gets its own
       entry so the two are told apart. */
    if (!sent.sent) {
      await logAudit({
        orgId,
        ...getAuditActor(gate.auth),
        action: "invite.send_failed",
        entityType: "user_invite",
        entityId: invite.id,
        entityLabel: invite.email,
        ipAddress: getRequestIp(request),
        metadata: { role: invite.role, failureReason: sent.reason },
      });
    }

    return NextResponse.json({ ...invite, emailed: sent.sent }, { status: 201 });
  } catch (error) {
    console.error("Failed to create invite:", error);
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }
}
