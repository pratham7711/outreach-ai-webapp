import { NextRequest, NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { connectionForRead } from "@/lib/creators/connectionGate";
import { readInsightsForConnection } from "@/lib/portal/instagramInsightsRead";
import { createLogger } from "@/lib/observability/logger";

/**
 * GET /api/portal/insights/instagram?account={id} — account insights (reach,
 * views, engagement, followers by day, follower demographics) and live story
 * insights for one of the creator's OWN connected Instagram accounts, for My
 * stats. Read from Instagram on every request; nothing is cached or stored.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const log = createLogger({ context: { call: "portal.instagram.insights" } });

const noStore = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest) {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const accountId = req.nextUrl.searchParams.get("account") ?? "";
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(accountId))
      return NextResponse.json({ error: "bad_account", reason: "Choose one of your connected accounts." }, { status: 400, headers: noStore });

    for (const creator of await findLinkedCreatorsForHandle(session)) {
      const read = await connectionForRead(creator.orgId, creator.id, "INSTAGRAM", { where: { id: accountId } });
      if (!read.ok) continue;
      const result = await readInsightsForConnection(read.connection, creator.orgId);
      return result.ok
        ? NextResponse.json(result.body, { headers: noStore })
        : NextResponse.json({ error: result.error, reason: result.reason }, { status: result.status, headers: noStore });
    }

    return NextResponse.json(
      { error: "not_your_account", reason: "That Instagram account is not connected to your portal." },
      { status: 404, headers: noStore },
    );
  } catch (error) {
    log.error("Failed to read the creator's Instagram insights", {
      message: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Failed to read insights" }, { status: 500 });
  }
}
