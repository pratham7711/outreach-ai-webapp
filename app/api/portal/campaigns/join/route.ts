import { NextRequest, NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { joinCampaignBySlug } from "@/lib/marketplace/join";
import { z } from "zod";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { requestLogger } from "@/lib/observability/requestLogger";

const joinSchema = z.object({
  slug: z.string().min(1),
  inviteCode: z.string().min(1).max(64).optional(),
});

// POST /api/portal/campaigns/join — join a marketplace campaign by public slug
export async function POST(request: NextRequest) {
  const { logger } = requestLogger("portal/campaigns/join");
  try {
    logger.info("join.start");
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = rateLimit({ key: rateLimitKey("portal/campaigns/join", request), limit: 20, windowMs: 60 * 60 * 1000 });
    if (!rl.allowed) {
      logger.warn("join.rate_limited", { retryAfterSeconds: rl.retryAfterSeconds });
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } }
      );
    }

    const body = await request.json();
    const parsed = joinSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid input", details: parsed.error.flatten() }, { status: 400 });
    }

    const result = await joinCampaignBySlug(session, parsed.data.slug, parsed.data.inviteCode);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    logger.info("join.done", { status: result.alreadyJoined ? 200 : 201 });
    return NextResponse.json(
      {
        activationId: result.activationId,
        campaignSlug: result.campaignSlug,
        alreadyJoined: result.alreadyJoined,
      },
      { status: result.alreadyJoined ? 200 : 201 }
    );
  } catch (error) {
    console.error("Failed to join campaign:", error);
    return NextResponse.json({ error: "Failed to join campaign" }, { status: 500 });
  }
}
