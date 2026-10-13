import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/observability/logger";
import { hashResetToken, RESET_LINK_INVALID } from "@/lib/passwordReset";

const RESET_PREFIX = "reset:";

/* The token is checked on its own so that a mangled link is reported as a bad
   link. Validated together, a short token surfaced zod's own wording ("String
   must contain at least 32 character(s)") on the reset page. */
const tokenSchema = z.string().min(32).max(256);
const passwordSchema = z.string().min(8, "Password must be at least 8 characters").max(200);

export async function POST(request: NextRequest) {
  const log = createLogger({ context: { route: "auth/reset-password" } });

  const rl = rateLimit({
    key: rateLimitKey("auth/reset-password", request),
    limit: 10,
    windowMs: 60 * 1000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const tokenParsed = tokenSchema.safeParse(body?.token);
  if (!tokenParsed.success) {
    return NextResponse.json({ error: RESET_LINK_INVALID }, { status: 400 });
  }
  const passwordParsed = passwordSchema.safeParse(body?.password);
  if (!passwordParsed.success) {
    return NextResponse.json(
      { error: passwordParsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const password = passwordParsed.data;
  /* Rows hold the token's hash (lib/passwordReset.ts), so the lookup is by
     hash too. A link minted before hashing shipped finds nothing here. */
  const tokenHash = hashResetToken(tokenParsed.data);

  try {
    const record = await db.verificationToken.findUnique({ where: { token: tokenHash } });
    if (!record || !record.identifier.startsWith(RESET_PREFIX)) {
      return NextResponse.json({ error: RESET_LINK_INVALID }, { status: 400 });
    }
    if (record.expires.getTime() < Date.now()) {
      await db.verificationToken.deleteMany({ where: { token: tokenHash } });
      return NextResponse.json({ error: RESET_LINK_INVALID }, { status: 400 });
    }

    const email = record.identifier.slice(RESET_PREFIX.length);
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      await db.verificationToken.deleteMany({ where: { token: tokenHash } });
      return NextResponse.json({ error: RESET_LINK_INVALID }, { status: 400 });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await db.$transaction([
      db.user.update({ where: { id: user.id }, data: { password: passwordHash } }),
      db.verificationToken.deleteMany({ where: { identifier: record.identifier } }),
    ]);

    log.info("reset_password.succeeded", { userId: user.id });
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("reset_password.failed", { error: (error as Error).message });
    return NextResponse.json({ error: "Could not reset the password" }, { status: 500 });
  }
}
