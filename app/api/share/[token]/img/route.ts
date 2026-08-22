import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { imageDimension, proxyImage } from "@/lib/media/proxyImage";

/**
 * GET /api/share/[token]/img?u=… — the image proxy, for the one page with no session.
 *
 * The client report is public by design, so it cannot use /api/img, which is
 * session-gated. Rendering the CDN URLs directly instead left 9 of the 14
 * creator avatars on this campaign's report as broken boxes: the Bubble CDN
 * serves them as image/heic and no browser decodes HEIC. Proxying through the
 * server also means the picture arrives for a viewer whose own network cannot
 * reach the platform's CDN, which is the normal case on some ISPs.
 *
 * What keeps this from being an open proxy, in order:
 *  - the host allowlist in proxyImage, which no caller can talk it out of;
 *  - a live share token, so bandwidth is spent only for reports someone has
 *    actually shared, and revoking the link closes this door with it.
 */

const SHARE_KIND = "campaign-performance";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  const link = await db.report.findUnique({
    where: { shareToken: token },
    select: { isPublic: true, config: true },
  });
  if (!link?.isPublic) return new NextResponse("not found", { status: 404 });
  const config = (link.config as { kind?: string } | null) ?? {};
  if (config.kind !== SHARE_KIND) return new NextResponse("not found", { status: 404 });

  const width = imageDimension(req.nextUrl.searchParams.get("w"), 96);
  const height = imageDimension(req.nextUrl.searchParams.get("h"), width);

  return proxyImage(req.nextUrl.searchParams.get("u"), width, height, "api/share/img");
}
