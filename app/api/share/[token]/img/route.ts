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

/*
  One database read per image is one too many. This report carries two dozen
  avatars, so opening it fired two dozen findUnique calls at once and Neon's
  pooler answered the burst with P1001 DatabaseNotReachable -- the pictures came
  back as 500s and the page fell through to initials.

  Whether a link is live changes rarely, so it is worth remembering briefly. The
  cost of that is the only real trade here: revoking a share link keeps letting
  images through for up to TTL_MS. The report itself re-checks on every page
  load and is not cached, so a revoked link stops rendering immediately -- this
  window applies only to images on a page someone already has open.

  Per-instance memory, like lib/rateLimit -- it shrinks the burst rather than
  eliminating the read.
*/
const TTL_MS = 60_000;
const liveLinks = new Map<string, { ok: boolean; at: number }>();

async function linkIsLive(token: string): Promise<boolean> {
  const now = Date.now();
  const seen = liveLinks.get(token);
  if (seen && now - seen.at < TTL_MS) return seen.ok;

  const link = await db.report.findUnique({
    where: { shareToken: token },
    select: { isPublic: true, config: true },
  });
  const config = (link?.config as { kind?: string } | null) ?? {};
  const ok = Boolean(link?.isPublic) && config.kind === SHARE_KIND;

  // Unknown tokens are cached too, so a scan for valid ones cannot turn into a
  // query per guess -- but that is also what makes this grow, hence the cap.
  if (liveLinks.size > 500) liveLinks.clear();
  liveLinks.set(token, { ok, at: now });
  return ok;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  if (!(await linkIsLive(token))) return new NextResponse("not found", { status: 404 });

  const width = imageDimension(req.nextUrl.searchParams.get("w"), 96);
  const height = imageDimension(req.nextUrl.searchParams.get("h"), width);

  return proxyImage(req.nextUrl.searchParams.get("u"), width, height, "api/share/img");
}
