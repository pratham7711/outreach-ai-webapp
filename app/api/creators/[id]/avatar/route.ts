import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { imageDimension, resizeImage } from "@/lib/media/proxyImage";
import { isProxyableHost } from "@/lib/postMedia";
import { isFetchableAvatarUrl, readStoredAvatar, storeAvatarFromUrl } from "@/lib/creators/avatarStore";
import { serveAvatar } from "@/lib/creators/avatarResponse";

export const runtime = "nodejs";

/**
 * A creator's profile picture, for any signed-in surface of their org.
 *
 * Every screen asks for a creator's picture by id alone, so none of them has to
 * know where it lives. What is stored in CreatorAvatar wins. Failing that, the
 * creator's own link is downloaded and stored on the spot -- the first view is
 * the fetcher for anyone the hourly pass has not reached yet. A 404 means no
 * picture, and the Avatar component shows initials for it.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("unauthorized", { status: 401 });
  const orgId = (session.user as { orgId?: string }).orgId;
  if (!orgId) return new NextResponse("unauthorized", { status: 401 });

  const { id } = await params;
  const width = imageDimension(req.nextUrl.searchParams.get("w"), 96);

  let stored = await readStoredAvatar(id, orgId);
  if (!stored) {
    const creator = await db.creator.findFirst({ where: { id, orgId }, select: { avatarUrl: true } });
    const url = creator?.avatarUrl;
    if (isFetchableAvatarUrl(url)) {
      let host = "";
      try {
        host = new URL(url).host;
      } catch {}
      // A link typed into the creator form, on a host we do not proxy, is the
      // browser's to fetch.
      if (host && !isProxyableHost(host)) return NextResponse.redirect(url, 302);
      if (await storeAvatarFromUrl(id, orgId, url)) stored = await readStoredAvatar(id, orgId);
    }
  }

  return serveAvatar(stored, width, resizeImage);
}
