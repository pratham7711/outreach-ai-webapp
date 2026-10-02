import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCreatorSession, hashPassword, verifyPassword } from "@/lib/creator-auth";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";

const schema = z.object({
  currentPassword: z.string().min(1),
  /* The same floor registration sets (app/api/portal/auth/register). */
  newPassword: z.string().min(8).max(200),
});

/**
 * POST /api/portal/account/password -- change the password from inside the
 * creator app.
 *
 * Creators had no way to change a password at all. This is the in-session
 * change: it asks for the current password, so a borrowed or left-open session
 * cannot lock the owner out. A forgotten-password reset by email is not offered
 * here, because nothing in the creator app may email a creator; the account
 * screen says to ask the agency instead.
 *
 * Every OTHER session of this login is signed out, so a password changed
 * because a device was lost actually locks that device out. The session making
 * the change is kept.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = rateLimit({
      key: rateLimitKey("portal/account/password", request),
      limit: 10,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Your new password needs at least 8 characters." },
        { status: 400 },
      );
    }
    const { currentPassword, newPassword } = parsed.data;

    const user = await db.creatorUser.findUnique({
      where: { id: session.creatorUserId },
      select: { passwordHash: true },
    });
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return NextResponse.json({ error: "Your current password is not right." }, { status: 403 });
    }

    await db.$transaction([
      db.creatorUser.update({
        where: { id: session.creatorUserId },
        data: { passwordHash: await hashPassword(newPassword) },
      }),
      db.creatorSession.deleteMany({
        where: { creatorUserId: session.creatorUserId, id: { not: session.id } },
      }),
    ]);

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Failed to change creator password:", error);
    return NextResponse.json({ error: "Failed to change the password" }, { status: 500 });
  }
}
