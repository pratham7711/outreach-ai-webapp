import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { z } from "zod";
import type { InviteStatus } from "@/lib/generated/prisma/client";

const respondSchema = z.object({
  token: z.string().min(1),
  action: z.enum(["ACCEPTED", "DECLINED"]),
});

// POST /api/campaign-invites/respond — Public endpoint (no auth required)
export async function POST(request: NextRequest) {
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
