import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCreatorSession } from "@/lib/creator-auth";
import { findLinkedCreatorsForHandle } from "@/lib/portal/creatorLink";
import { buildHomeTodo, listInvitedCampaigns, listJoinedCampaigns } from "@/lib/portal/myCampaigns";

/**
 * GET /api/portal/home -- the creator app's Home: what needs doing, in order,
 * then every campaign with its next date.
 *
 * Replaces /api/portal/dashboard for the creator app. That route summarised
 * proposals and lifetime earnings, both of which are off the creator screens
 * (no proposals, no money); it is left in place for anything still calling it.
 */
export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const joined = await listJoinedCampaigns(session);
    const invited = await listInvitedCampaigns(session, new Set(joined.map((c) => c.campaignId)));

    /* "Connected" means an account the creator authorised: rows on a roster
       row they have proven they own, or rows the OAuth callback stamped with
       this login. An agency's hand-typed row (origin "manual") holds no
       credential and does not count -- the creator still has something to do. */
    const linked = await findLinkedCreatorsForHandle(session);
    const connectedAccounts = await db.creatorSocialAccount.count({
      where: {
        AND: [
          {
            OR: [
              ...(linked.length > 0 ? [{ creatorId: { in: linked.map((c) => c.id) } }] : []),
              { creatorUserId: session.creatorUserId },
            ],
          },
          { OR: [{ origin: null }, { origin: { not: "manual" } }] },
        ],
      },
    });

    return NextResponse.json({
      name: session.name,
      todo: buildHomeTodo(joined, connectedAccounts),
      campaigns: joined,
      invited,
      connectedAccounts,
    });
  } catch (error) {
    console.error("Failed to build creator home:", error);
    return NextResponse.json({ error: "Failed to load home" }, { status: 500 });
  }
}
