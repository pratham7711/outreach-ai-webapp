import { NextResponse } from "next/server";
import { getCreatorSession } from "@/lib/creator-auth";
import { tiktokBusinessConfigured, tiktokBusinessMocked } from "@/lib/platforms/tiktokBusiness";
import { tiktokBusinessSummary } from "@/lib/portal/tiktokBusinessConnection";
import { noStore } from "../shared";

export const dynamic = "force-dynamic";

/** GET /api/portal/tiktok-business/status — for the My accounts card: whether
    TikTok for Business can be connected here, and the stored connection if
    any. Reads nothing from TikTok. */
export async function GET() {
  const session = await getCreatorSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const summary = await tiktokBusinessSummary(session.creatorUserId);
  return NextResponse.json(
    {
      available: summary !== "unavailable" && (tiktokBusinessConfigured() || tiktokBusinessMocked()),
      connection: summary === "unavailable" ? null : summary,
    },
    { headers: noStore },
  );
}
