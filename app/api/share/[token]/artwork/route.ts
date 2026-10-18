import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { imageDimension, resizeImage } from "@/lib/media/proxyImage";
import { serveThumbnail } from "@/lib/posts/thumbnailResponse";
import { readStoredCampaignThumbnail } from "@/lib/campaigns/thumbnailCopy";

export const runtime = "nodejs";

const SHARE_KIND = "campaign-performance";

/*
  The client report's header picture, for a viewer with no session: our copy
  of the link's own campaign's picture. The path names no campaign, so a token
  reaches only the picture its report already shows. Like the sound cover
  beside it, not gated on a visibility flag -- a campaign's picture names no
  creator.
*/
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await db.report.findUnique({
    where: { shareToken: token },
    select: { isPublic: true, config: true, orgId: true, campaignId: true, campaign: { select: { orgId: true } } },
  });
  const config = (link?.config as { kind?: string } | null) ?? {};
  if (!link?.isPublic || config.kind !== SHARE_KIND || !link.campaignId || link.campaign?.orgId !== link.orgId) {
    return new NextResponse("not found", { status: 404 });
  }

  const width = imageDimension(req.nextUrl.searchParams.get("w"), 384);
  const height = imageDimension(req.nextUrl.searchParams.get("h"), width);
  return serveThumbnail(await readStoredCampaignThumbnail(link.campaignId, link.orgId), width, height, resizeImage);
}
