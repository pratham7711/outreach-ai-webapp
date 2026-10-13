import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { imageDimension, resizeImage } from "@/lib/media/proxyImage";
import { readStoredThumbnail } from "@/lib/posts/thumbnailStore";
import { NOT_REMOVED } from "@/lib/posts/removed";
import { serveThumbnail } from "@/lib/posts/thumbnailResponse";
import { parseShareVisibility } from "@/lib/reports/shareVisibility";

export const runtime = "nodejs";

const SHARE_KIND = "campaign-performance";
const TTL_MS = 60_000;

/*
  The client report's post pictures, for a viewer with no session.

  A live link may only show pictures of the posts the report itself lists: its
  own campaign, in its own org, on the platforms the link was cut for
  (computeCampaignPerformance's own filter). The post lookup carries all three,
  so a token for one campaign cannot fetch another campaign's picture by id --
  it gets the same 404 as a post that does not exist.

  A link that hides creators shows no pictures at all: redactForShare strips
  the thumbnail on such a link because a cover identifies the creator as surely
  as the name does, and this door has to stay shut with it.

  The link itself is remembered briefly, as in the sibling avatar route: the
  report fires two dozen of these at once, and a lookup per image is what once
  made Neon's pooler answer P1001.
*/
type Link = { orgId: string; campaignId: string; platforms: string[] } | null;
const links = new Map<string, { at: number; link: Promise<Link> }>();

function shareLink(token: string): Promise<Link> {
  const now = Date.now();
  const seen = links.get(token);
  if (seen && now - seen.at < TTL_MS) return seen.link;
  const link = lookUp(token);
  // A failed lookup is not an answer; the next picture asks again.
  link.catch(() => links.get(token)?.link === link && links.delete(token));
  if (links.size > 500) links.clear();
  links.set(token, { at: now, link });
  return link;
}

async function lookUp(token: string): Promise<Link> {
  const link = await db.report.findUnique({
    where: { shareToken: token },
    select: { isPublic: true, config: true, orgId: true, campaignId: true },
  });
  const config = (link?.config as { kind?: string } | null) ?? {};
  const visibility = parseShareVisibility(link?.config);
  if (!(link?.isPublic && config.kind === SHARE_KIND && link.campaignId && visibility.showCreators)) return null;
  return { orgId: link.orgId, campaignId: link.campaignId, platforms: visibility.platforms };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; postId: string }> }
) {
  const { token, postId } = await params;
  const link = await shareLink(token);
  if (!link) return new NextResponse("not found", { status: 404 });

  const width = imageDimension(req.nextUrl.searchParams.get("w"), 478);
  const height = imageDimension(req.nextUrl.searchParams.get("h"), width);
  const stored = await readStoredThumbnail(postId, link.orgId, {
    campaignId: link.campaignId,
    campaign: { orgId: link.orgId },
    ...NOT_REMOVED,
    ...(link.platforms.length ? { platform: { in: link.platforms } } : {}),
  });
  return serveThumbnail(stored, width, height, resizeImage);
}
