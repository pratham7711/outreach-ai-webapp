import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createAuditActor, logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const VALID_ROLES = ["OWNER", "ADMIN", "MANAGER", "MEMBER", "VIEWER"] as const;

// GET /api/invites — List all invites for the org
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;

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
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;

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
      ...createAuditActor(session),
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

    return NextResponse.json(invite, { status: 201 });
  } catch (error) {
    console.error("Failed to create invite:", error);
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }
}
