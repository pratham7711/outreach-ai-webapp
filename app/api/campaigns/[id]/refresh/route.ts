import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { createLogger } from "@/lib/observability/logger";
import { getRefreshCooldown, refreshCampaign } from "@/lib/sync/refreshCampaign";

/**
 * POST /api/campaigns/[id]/refresh — refresh everything the campaign reports on.
 * GET  /api/campaigns/[id]/refresh — how long until it may be refreshed again,
 *      and how far along a run in flight is, so the button can show "N of M".
 *
 * Thin on purpose. The work, and more importantly the thirty-minute gate, live
 * in lib/sync/refreshCampaign so that the MCP server drives exactly the same
 * operation under exactly the same limit -- a cooldown enforced in this handler
 * alone would be bypassed by the first caller that is not this handler.
 */

/* The work is paced -- roughly a second and a half between platform requests --
   so an eighty-post campaign needs minutes, not seconds. At the old default
   this route had 45s, which bought about 25 posts and reported the rest as
   "remaining" every single time. */
export const maxDuration = 300;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id: campaignId } = await params;

  const state = await getRefreshCooldown(orgId, campaignId);
  if (!state) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  return NextResponse.json(state);
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const log = createLogger({ context: { route: "campaigns/[id]/refresh" } });
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const orgId = (session.user as any).orgId;
    const userId = (session.user as any).id as string | undefined;
    const { id: campaignId } = await params;

    const outcome = await refreshCampaign({ orgId, campaignId, userId });

    if (!outcome.ok && outcome.reason === "not-found") {
      return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
    }
    if (!outcome.ok && outcome.reason === "cooldown") {
      return NextResponse.json(
        { error: outcome.message, ...outcome.state },
        { status: 429, headers: { "Retry-After": String(outcome.state.retryAfterSeconds) } }
      );
    }
    if (!outcome.ok) return NextResponse.json({ error: "Refresh failed" }, { status: 500 });

    return NextResponse.json(outcome.result);
  } catch (error) {
    log.error("campaign refresh failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Refresh failed" }, { status: 500 });
  }
}
