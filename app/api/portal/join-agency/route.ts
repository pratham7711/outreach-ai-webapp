import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCreatorSession } from "@/lib/creator-auth";
import { resolveJoinCode } from "@/lib/creators/joinLink";
import { joinAgency } from "@/lib/portal/joinAgency";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { requestLogger } from "@/lib/observability/requestLogger";

/**
 * GET  /api/portal/join-agency?code=<code> -- the agency name for the sign-up
 *      page's "Sign up to join <agency>". Public: it is what the link shows.
 * POST /api/portal/join-agency { code } -- after sign-up or sign-in, puts the
 *      creator on that agency's roster. See lib/portal/joinAgency.ts.
 */
const Body = z.object({ code: z.string().min(1).max(40) });

export async function GET(request: NextRequest) {
  const link = await resolveJoinCode(request.nextUrl.searchParams.get("code"));
  if (!link) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ agency: link.agency });
}

export async function POST(request: NextRequest) {
  const { logger } = requestLogger("portal/join-agency");
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = rateLimit({ key: rateLimitKey("portal/join-agency", request), limit: 20, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const parsed = Body.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

    const result = await joinAgency(session, parsed.data.code);
    if (!result.ok) {
      logger.info("join_agency.refused", { status: result.status });
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    logger.info("join_agency.done", { alreadyOnRoster: result.alreadyOnRoster });
    return NextResponse.json(
      { agency: result.agency, alreadyOnRoster: result.alreadyOnRoster },
      { status: result.alreadyOnRoster ? 200 : 201 },
    );
  } catch (error) {
    console.error("Failed to join agency:", error);
    return NextResponse.json({ error: "Couldn't add you to the roster" }, { status: 500 });
  }
}
