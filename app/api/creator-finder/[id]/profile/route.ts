import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireCreatorFinder, noStore } from "@/lib/creatorFinder/gate";
import { isMissingProspectTable } from "@/lib/creatorFinder/prospectDdl";
import { readLiveProfile } from "@/lib/creatorFinder/liveProfile";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function refuse(status: number, error: string, reason: string) {
  return NextResponse.json({ error, reason }, { status, headers: noStore });
}

/**
 * GET /api/creator-finder/[id]/profile -- the prospect's public profile and
 * the contact routes in it, read live and never stored
 * (lib/creatorFinder/liveProfile.ts).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireCreatorFinder(req);
  if (auth instanceof NextResponse) return auth;
  const { orgId } = auth;
  const { id } = await params;

  let prospect;
  try {
    prospect = await db.creatorProspect.findFirst({ where: { id, orgId } });
  } catch (e) {
    if (isMissingProspectTable(e)) return refuse(503, "not_set_up", "Creator Finder's tables aren't on this database yet.");
    throw e;
  }
  if (!prospect) return refuse(404, "not_found", "This card is no longer on the board.");

  const read = await readLiveProfile(orgId, prospect);
  if (!read.ok) return refuse(read.status, read.error, read.reason);
  return NextResponse.json({ ...read, stored: false }, { headers: noStore });
}
