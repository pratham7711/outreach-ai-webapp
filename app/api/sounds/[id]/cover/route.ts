import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/authenticate";
import { imageDimension, resizeImage } from "@/lib/media/proxyImage";
import { serveThumbnail } from "@/lib/posts/thumbnailResponse";
import { readStoredSoundCover } from "@/lib/sounds/coverStore";

export const runtime = "nodejs";

/**
 * A sound's stored cover (SoundCover), for the signed-in screens of its org:
 * the trackers page, the campaigns list and the campaign's audio card.
 *
 * Org-scoped like GET /api/trackers, which lists every sound in the org to
 * every member. Read-only: a screen only points here for a sound it already
 * knows has a copy (lib/sounds/coverStore#storedSoundCoverVersions), so a miss
 * is a plain 404 and the screen's own placeholder shows.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(req);
  if (!auth) return new NextResponse("unauthorized", { status: 401 });

  const { id } = await params;
  const width = imageDimension(req.nextUrl.searchParams.get("w"), 128);
  const height = imageDimension(req.nextUrl.searchParams.get("h"), width);
  return serveThumbnail(await readStoredSoundCover(id, auth.orgId), width, height, resizeImage);
}
