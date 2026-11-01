import { NextRequest, NextResponse } from "next/server";
import { requireCreatorFinder, noStore } from "@/lib/creatorFinder/gate";
import { permissionDenial } from "@/lib/authz";
import { listJoinableCampaigns } from "@/lib/creatorFinder/campaigns";

export const dynamic = "force-dynamic";

/**
 * GET /api/creator-finder/campaigns -- the campaigns a first message can
 * invite a prospect into, each with its join link (lib/creatorFinder/campaigns.ts).
 * An invite-only campaign's link carries its code, so this needs the same
 * permission as working the board.
 */
export async function GET(req: NextRequest) {
  const auth = await requireCreatorFinder(req);
  if (auth instanceof NextResponse) return auth;
  const denied = permissionDenial(auth, "creators:create");
  if (denied) return denied;
  const { campaigns, otherOpen } = await listJoinableCampaigns(auth);
  return NextResponse.json({ campaigns, otherOpen }, { headers: noStore });
}
