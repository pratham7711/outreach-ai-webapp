import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";

/**
 * The two pickers in the New Payout dialog, fetched when it opens.
 *
 * The payouts page used to select every creator and every campaign in the org
 * and hand both to the client component, which passed them straight to a modal
 * that is usually never opened. Measured, that was 1,837 creators and 521
 * campaigns serialised into the RSC payload of every page load: 265KB of
 * document to show three payouts, against 65KB for a comparable page.
 *
 * Neither list is paginated here on purpose. /api/creators caps at 200 a page,
 * and a picker that can only reach the first 200 creators would quietly stop
 * being able to pay the rest.
 */
export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;

  const [creators, campaigns] = await Promise.all([
    db.creator.findMany({
      where: { orgId, deletedAt: null },
      select: { id: true, name: true, handle: true },
      orderBy: { name: "asc" },
    }),
    db.campaign.findMany({
      where: { orgId, deletedAt: null },
      select: { id: true, title: true },
      orderBy: { title: "asc" },
    }),
  ]);

  return NextResponse.json({ creators, campaigns });
}
