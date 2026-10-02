import { NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { listInvitedCampaigns, listJoinedCampaigns } from "@/lib/portal/myCampaigns";

/**
 * GET /api/portal/campaigns -- the creator app's Joined and Invited tabs.
 *
 * This listed marketplace earnings per campaign, matched by handle alone. It
 * now answers which campaigns the creator is on and which they are invited to,
 * by the rules in lib/portal/myCampaigns.ts: an agency's private campaign
 * appears only through a roster row linked to this login, never by handle
 * (plan failure F10). The Open tab reads /api/public/marketplace, the same list
 * /explore shows. Money is not part of this payload; the creator app does not
 * show earnings (lib/moneyUi.ts).
 */
export async function GET() {
  try {
    const session = await getCreatorSession();
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const joined = await listJoinedCampaigns(session);
    const invited = await listInvitedCampaigns(session, new Set(joined.map((c) => c.campaignId)));

    return NextResponse.json({ joined, invited });
  } catch (error) {
    console.error("Failed to fetch creator campaigns:", error);
    return NextResponse.json({ error: "Failed to fetch campaigns" }, { status: 500 });
  }
}
