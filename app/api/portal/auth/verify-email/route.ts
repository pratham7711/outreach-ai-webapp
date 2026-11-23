import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createCreatorSession } from "@/lib/creator-auth";
import { creatorEmailState, verifyCreatorEmailToken } from "@/lib/portal/creatorEmailVerification";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { requestLogger } from "@/lib/observability/requestLogger";

/**
 * POST /api/portal/auth/verify-email { token } -- the "Confirm email" button on
 * /portal/verify-email. Confirms the address and signs the creator in.
 *
 * A POST from a button rather than the GET of the mailed link itself, so a
 * mail scanner that opens every link cannot spend it or collect a session.
 */
const Body = z.object({ token: z.string().min(1).max(200) });

export async function POST(request: NextRequest) {
  const { logger } = requestLogger("portal/auth/verify-email");
  try {
    const rl = rateLimit({ key: rateLimitKey("portal/auth/verify-email", request), limit: 20, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
    if ((await creatorEmailState("")) === "unavailable") {
      return NextResponse.json({ error: "Being updated. Try again in a minute." }, { status: 503 });
    }

    const outcome = await verifyCreatorEmailToken(parsed.data.token);
    if (!outcome.ok) {
      logger.info("creator_verify.refused", { reason: outcome.reason });
      return NextResponse.json({ error: outcome.reason }, { status: 400 });
    }
    await createCreatorSession(outcome.creatorUserId);
    logger.info("creator_verify.done", { alreadyVerified: outcome.alreadyVerified });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Creator email confirmation failed:", error);
    return NextResponse.json({ error: "Confirmation failed" }, { status: 500 });
  }
}
