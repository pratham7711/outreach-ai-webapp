import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCreatorSession } from "@/lib/creator-auth";
import { claimConnectLink } from "@/lib/portal/connectLinkClaim";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { requestLogger } from "@/lib/observability/requestLogger";

/**
 * POST /api/portal/connect-link/claim { token } -- after a creator who
 * connected through an agency's link (/connect/<token>) signs up or signs in,
 * names their login on that roster row, so My accounts and My stats show the
 * accounts they just connected. See lib/portal/connectLinkClaim.ts.
 */
const Body = z.object({ token: z.string().min(1).max(200) });

export async function POST(request: NextRequest) {
  const { logger } = requestLogger("portal/connect-link/claim");
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = rateLimit({
      key: rateLimitKey("portal/connect-link/claim", request),
      limit: 20,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const result = await claimConnectLink(session, parsed.data.token);
    if (!result.ok) {
      logger.info("connect_link.claim.refused", { status: result.status });
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    logger.info("connect_link.claim.done", { alreadyLinked: result.alreadyLinked });
    return NextResponse.json({ alreadyLinked: result.alreadyLinked }, { status: result.alreadyLinked ? 200 : 201 });
  } catch (error) {
    console.error("Failed to claim connect link:", error);
    return NextResponse.json({ error: "Failed to link your accounts" }, { status: 500 });
  }
}
