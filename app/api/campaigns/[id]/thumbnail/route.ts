import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/authenticate";
import { imageDimension, resizeImage } from "@/lib/media/proxyImage";
import { serveThumbnail } from "@/lib/posts/thumbnailResponse";
import { readStoredCampaignThumbnail } from "@/lib/campaigns/thumbnailCopy";

export const runtime = "nodejs";

/**
 * A campaign's stored picture (CampaignThumbnail), for the signed-in screens
 * of its org: the campaigns list. Org-scoped like the list itself. Serves the
 * copy only while the campaign still points at the picture it was taken from,
 * so a changed or cleared thumbnail is never answered with the old one.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateRequest(req);
  if (!auth) return new NextResponse("unauthorized", { status: 401 });

  const { id } = await params;
  const width = imageDimension(req.nextUrl.searchParams.get("w"), 128);
  const height = imageDimension(req.nextUrl.searchParams.get("h"), width);
  return serveThumbnail(await readStoredCampaignThumbnail(id, auth.orgId), width, height, resizeImage);
}
