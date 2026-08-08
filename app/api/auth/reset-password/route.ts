import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/observability/logger";

const RESET_PREFIX = "reset:";

const schema = z.object({
  token: z.string().min(32),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

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

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const { token, password } = parsed.data;

  try {
    const record = await db.verificationToken.findUnique({ where: { token } });
    if (!record || !record.identifier.startsWith(RESET_PREFIX)) {
      return NextResponse.json({ error: "This reset link is not valid" }, { status: 400 });
    }
    if (record.expires.getTime() < Date.now()) {
      await db.verificationToken.deleteMany({ where: { token } });
      return NextResponse.json({ error: "This reset link has expired" }, { status: 400 });
    }

    const email = record.identifier.slice(RESET_PREFIX.length);
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      await db.verificationToken.deleteMany({ where: { token } });
      return NextResponse.json({ error: "This reset link is not valid" }, { status: 400 });
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
