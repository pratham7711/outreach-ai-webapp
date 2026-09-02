import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/observability/logger";
import { verifyEmailToken } from "@/lib/emailVerification";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

/**
 * Spend a signup verification link.
 *
 * Unauthenticated on purpose: the whole point is that the person holding the
 * mail may not be signed in, and requiring a session would mean the one user
 * who most needs this -- someone who mistyped their address and cannot receive
 * the reset mail either -- can never reach it.
 */

const schema = z.object({ token: z.string().min(32).max(400) });

export async function POST(request: NextRequest) {
  const log = createLogger({ context: { route: "auth/verify-email" } });

  const rl = rateLimit({
    key: rateLimitKey("auth/verify-email", request),
    limit: 20,
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
    return NextResponse.json({ error: "This confirmation link is not valid" }, { status: 400 });
  }

  try {
    const outcome = await verifyEmailToken(parsed.data.token);
    if (!outcome.ok) {
      return NextResponse.json(
        {
          error:
            outcome.reason === "expired"
              ? "This confirmation link has expired"
              : "This confirmation link is not valid",
          expired: outcome.reason === "expired",
        },
        { status: 400 }
      );
    }

    /* Only the first time. Clicking twice is a non-event and an audit trail
       that records it as a fresh confirmation would misreport when the address
       was actually proven. */
    if (!outcome.alreadyVerified) {
      await logAudit({
        orgId: outcome.orgId,
        userId: outcome.userId,
        actorType: "user",
        actorEmail: outcome.email,
        action: "email.verified",
        entityType: "user",
        entityId: outcome.userId,
        entityLabel: outcome.email,
        ipAddress: getRequestIp(request),
      });
      log.info("verify_email.succeeded", { userId: outcome.userId });
    }

    return NextResponse.json({ ok: true, alreadyVerified: outcome.alreadyVerified });
  } catch (error) {
    log.error("verify_email.failed", { error: (error as Error).message });
    return NextResponse.json({ error: "Could not confirm the email" }, { status: 500 });
  }
}
