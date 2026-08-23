import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/observability/logger";
import { sendEmail, emailConfigured } from "@/lib/email";
import { BRAND } from "@/lib/brand";

const RESET_PREFIX = "reset:";
const TTL_MS = 60 * 60 * 1000;

const schema = z.object({ email: z.string().email() });

export function resetIdentifier(email: string): string {
  return `${RESET_PREFIX}${email.toLowerCase()}`;
}

export async function POST(request: NextRequest) {
  const log = createLogger({ context: { route: "auth/forgot-password" } });

  const rl = rateLimit({
    key: rateLimitKey("auth/forgot-password", request),
    limit: 5,
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
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();
  const identifier = resetIdentifier(email);
  const generic = { ok: true as const };

  try {
    const user = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (!user) {
      log.info("forgot_password.unknown_email");
      return NextResponse.json(generic);
    }

    const token = randomBytes(32).toString("hex");
    await db.verificationToken.deleteMany({ where: { identifier } });
    await db.verificationToken.create({
      data: { identifier, token, expires: new Date(Date.now() + TTL_MS) },
    });

    const origin =
      process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin;
    const resetUrl = `${origin.replace(/\/+$/, "")}/reset-password?token=${token}`;

    if (!emailConfigured()) {
      // Keep the old escape hatch: without a provider the link only reaches the
      // logs, which is the difference between "recoverable" and "locked out".
      log.warn("forgot_password.email_provider_missing", {
        message: "No transactional email provider is configured; reset link was not emailed.",
        resetUrl,
      });
    } else {
      const sent = await sendEmail({
        to: email,
        subject: `Reset your ${BRAND.name} password`,
        text: [
          "Someone asked to reset the password for this account.",
          "",
          `Open this link within the hour to choose a new one:`,
          resetUrl,
          "",
          "If that wasn't you, ignore this email -- the link expires on its own",
          "and your current password keeps working.",
        ].join("\n"),
      });
      if (!sent.sent) {
        // Still log the URL so a failed send is recoverable by hand.
        log.error("forgot_password.send_failed", { reason: sent.reason, resetUrl });
      }
    }

    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json({ ...generic, devResetUrl: resetUrl });
    }
    return NextResponse.json(generic);
  } catch (error) {
    log.error("forgot_password.failed", { error: (error as Error).message });
    return NextResponse.json({ error: "Could not process the request" }, { status: 500 });
  }
}
