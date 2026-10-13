import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import type { InviteStatus } from "@/lib/generated/prisma/client";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";

const respondSchema = z.object({
  token: z.string().min(1),
  action: z.enum(["ACCEPTED", "DECLINED"]),
});

// POST /api/campaign-invites/respond — Public endpoint (no auth required)
export async function POST(request: NextRequest) {
  /* Unauthenticated and keyed by a token, so the one brake on someone walking
     the token space is this. The same allowance as the portal's own invite
     accept (portal/invites/[token]/accept): a person answers an invite once. */
  const rl = rateLimit({
    key: rateLimitKey("campaign-invites/respond", request),
    limit: 20,
    windowMs: 60 * 60 * 1000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  try {
    const body = await request.json();
    const parsed = respondSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const invite = await db.campaignInvite.findUnique({ where: { inviteToken: parsed.data.token } });
    if (!invite) return NextResponse.json({ error: "Invite not found" }, { status: 404 });

    if (invite.status !== "PENDING") {
      return NextResponse.json({ error: "Invite has already been responded to" }, { status: 400 });
    }

    const updated = await db.campaignInvite.update({
      where: { id: invite.id },
      data: {
        status: parsed.data.action as InviteStatus,
        respondedAt: new Date(),
      },
    });

    return NextResponse.json({ success: true, status: updated.status });
  } catch (error) {
    console.error("Failed to respond to invite:", error);
    return NextResponse.json({ error: "Failed to respond to invite" }, { status: 500 });
  }
}
