import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/observability/logger";
import { emailConfigured } from "@/lib/email";
import { issueEmailVerification, appOrigin } from "@/lib/emailVerification";

/**
 * Send the confirmation mail again.
 *
 * Answers identically for an unknown address, an already-confirmed one and a
 * freshly-sent one, for the same reason forgot-password does: an endpoint that
 * distinguishes them is an endpoint that tells a stranger which addresses hold
 * accounts here. `delivery` describes the SERVER's configuration, not the
 * account, so saying "unavailable" leaks nothing while still sparing the user
 * from waiting on a mail that was never going to arrive.
 */

const schema = z.object({ email: z.string().email() });

export async function POST(request: NextRequest) {
  const log = createLogger({ context: { route: "auth/resend-verification" } });

  /* Tighter than forgot-password's five a minute. This one mails an address
     supplied by whoever is calling, so a loose limit here is a way to have our
     sending domain send someone a hundred emails they never asked for. */
  const rl = rateLimit({
    key: rateLimitKey("auth/resend-verification", request),
    limit: 3,
    windowMs: 15 * 60 * 1000,
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
  const generic = {
    ok: true as const,
    delivery: (emailConfigured() ? "sent" : "unavailable") as "sent" | "unavailable",
  };

  try {
    const user = await db.user.findUnique({
      where: { email },
      select: { id: true, orgId: true, name: true, emailVerified: true },
    });
    // Unknown, or already done. Both say the same thing to the caller.
    if (!user || user.emailVerified) return NextResponse.json(generic);

    const { url } = await issueEmailVerification({
      email,
      name: user.name,
      orgId: user.orgId,
      userId: user.id,
      origin: appOrigin(request.nextUrl.origin),
    });

    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json({ ...generic, devVerifyUrl: url });
    }
    return NextResponse.json(generic);
  } catch (error) {
    log.error("resend_verification.failed", { error: (error as Error).message });
    return NextResponse.json({ error: "Could not send the email" }, { status: 500 });
  }
}
