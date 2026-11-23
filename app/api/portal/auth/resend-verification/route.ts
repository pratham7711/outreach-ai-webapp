import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { appOrigin, creatorEmailState, issueCreatorVerification } from "@/lib/portal/creatorEmailVerification";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { requestLogger } from "@/lib/observability/requestLogger";
import { ErrandBody, errandQueryOf } from "../errandBody";

/**
 * POST /api/portal/auth/resend-verification { email, errand? } -- "Send a new
 * link" on the check-your-email screen. Answers the same whether or not the
 * address has an account, so it cannot be used to find out who has one; the
 * link only ever goes to the address itself.
 */
const Body = z.object({ email: z.string().email(), errand: ErrandBody });

export async function POST(request: NextRequest) {
  const { logger } = requestLogger("portal/auth/resend-verification");
  try {
    const rl = rateLimit({ key: rateLimitKey("portal/auth/resend-verification", request), limit: 5, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }
    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const user = await db.creatorUser.findUnique({ where: { email: parsed.data.email }, select: { id: true, email: true, name: true } });
    let devVerifyUrl: string | null = null;
    if (user && (await creatorEmailState(user.id)) === "unverified") {
      const issued = await issueCreatorVerification({
        email: user.email,
        name: user.name,
        origin: appOrigin(request.nextUrl.origin),
        errandQuery: errandQueryOf(parsed.data.errand),
      });
      devVerifyUrl = issued.url;
      logger.info("creator_verify.resent", { sent: issued.sent, reused: issued.reused });
    }
    return NextResponse.json({
      ok: true,
      ...(process.env.NODE_ENV !== "production" && devVerifyUrl ? { devVerifyUrl } : {}),
    });
  } catch (error) {
    console.error("Resend creator verification failed:", error);
    return NextResponse.json({ error: "Couldn't send a new link" }, { status: 500 });
  }
}
