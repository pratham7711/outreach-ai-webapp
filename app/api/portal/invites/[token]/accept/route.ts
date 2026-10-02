import { NextRequest, NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { acceptCampaignInvite } from "@/lib/portal/campaignInvite";
import { rateLimit, rateLimitKey } from "@/lib/rateLimit";
import { requestLogger } from "@/lib/observability/requestLogger";

/**
 * POST /api/portal/invites/<token>/accept -- the Accept button on /invite/<token>.
 *
 * Needs a creator login: accepting puts the creator on the campaign and links
 * the invited roster row to them, so there has to be a "them". A signed-out
 * creator gets a 401 and the landing page sends them to sign up or sign in with
 * the token carried along, which accepts on the way back (portal register and
 * login pages).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { logger } = requestLogger("portal/invites/accept");
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = rateLimit({
      key: rateLimitKey("portal/invites/accept", request),
      limit: 20,
      windowMs: 60 * 60 * 1000,
    });
    if (!rl.allowed) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSeconds) } },
      );
    }

    const { token } = await params;
    const result = await acceptCampaignInvite(session, token);
    if (!result.ok) {
      logger.info("invite.accept.refused", { status: result.status });
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    logger.info("invite.accept.done", { alreadyAccepted: result.alreadyAccepted });
    return NextResponse.json(
      {
        campaignPath: result.campaignPath,
        activationId: result.activationId,
        alreadyAccepted: result.alreadyAccepted,
      },
      { status: result.alreadyAccepted ? 200 : 201 },
    );
  } catch (error) {
    console.error("Failed to accept campaign invite:", error);
    return NextResponse.json({ error: "Failed to accept the invite" }, { status: 500 });
  }
}
