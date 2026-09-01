import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requirePermission } from "@/lib/authz";
import { getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";
import { sendInviteEmail } from "@/lib/inviteEmail";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";

/**
 * POST /api/invites/[id]/resend — send the invite mail again.
 *
 * Needed on day one rather than eventually: every invite created before the
 * mail path existed was never delivered to anyone, and those rows are still
 * pending and still valid. This is how they reach their recipient without
 * cancelling and re-inviting, which would mint a new token and invalidate any
 * link that had already been passed along by hand.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const gate = await requirePermission(request, "users:manage");
    if (!gate.ok) return gate.response;
    const { orgId } = gate.auth;

    /* Resend puts mail in somebody's inbox on demand, so it is the one action
       here worth rate limiting -- otherwise it is a button that spams a third
       party at the caller's chosen pace. */
    const rl = rateLimit({ key: rateLimitKey("invite-resend", request), limit: 10, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many resends. Try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const { id } = await params;
    const invite = await db.userInvite.findUnique({
      where: { id },
      include: { organization: { select: { name: true, brandName: true } } },
    });

    /* Same 404 for "not ours" as for "not there": whether an invite id exists
       in another org is not this caller's business. */
    if (!invite || invite.orgId !== orgId) {
      return NextResponse.json({ error: "Invite not found" }, { status: 404 });
    }
    if (invite.acceptedAt) {
      return NextResponse.json({ error: "That invite has already been accepted" }, { status: 409 });
    }
    if (invite.expiresAt < new Date()) {
      return NextResponse.json(
        { error: "That invite has expired. Cancel it and send a new one." },
        { status: 409 }
      );
    }

    const origin =
      process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const sent = await sendInviteEmail({
      to: invite.email,
      orgName: invite.organization.brandName || invite.organization.name || "the team",
      role: invite.role,
      token: invite.token,
      origin,
      expiresAt: invite.expiresAt,
      invitedByEmail: gate.auth.actorEmail ?? null,
    });

    if (!sent.sent) {
      return NextResponse.json(
        {
          error:
            sent.reason === "not-configured"
              ? "Email is not configured on this deployment. Copy the invite link instead."
              : "The email provider refused the message. Copy the invite link instead.",
          emailed: false,
        },
        { status: 502 }
      );
    }

    await logAudit({
      orgId,
      ...getAuditActor(gate.auth),
      action: "invite.resend",
      entityType: "user_invite",
      entityId: invite.id,
      entityLabel: invite.email,
      ipAddress: getRequestIp(request),
      metadata: { role: invite.role, expiresAt: invite.expiresAt.toISOString() },
    });

    return NextResponse.json({ success: true, emailed: true });
  } catch (error) {
    console.error("Failed to resend invite:", error);
    return NextResponse.json({ error: "Failed to resend invite" }, { status: 500 });
  }
}
