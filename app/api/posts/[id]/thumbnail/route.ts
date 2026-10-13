import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { permissionDenial } from "@/lib/authz";
import { accessSubjectFromSession } from "@/lib/campaignAccess";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import { imageDimension, resizeImage } from "@/lib/media/proxyImage";
import { readStoredThumbnail } from "@/lib/posts/thumbnailStore";
import { serveThumbnail } from "@/lib/posts/thumbnailResponse";

export const runtime = "nodejs";

/**
 * A post's stored picture (PostThumbnail), for the signed-in screens of its org.
 *
 * Read-only, unlike the avatar route: a list only points here for a post it
 * already knows has a copy (lib/posts/thumbnailStore#storedThumbnailVersions),
 * and every other post keeps its stored link through /api/img. So a miss is a
 * plain 404 and the card's own placeholder shows.
 *
 * Org first, then row scope: an "assigned campaigns only" seat must not reach a
 * picture from a campaign it cannot open (lib/campaignAccess). For everyone
 * else that clause is empty and the lookup stays one primary-key read.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return new NextResponse("unauthorized", { status: 401 });
  const denied = permissionDenial(session.user, "campaigns:read");
  if (denied) return denied;
  const subject = accessSubjectFromSession(session.user);
  if (!subject) return new NextResponse("unauthorized", { status: 401 });

  const { id } = await params;
  const width = imageDimension(req.nextUrl.searchParams.get("w"), 320);
  const height = imageDimension(req.nextUrl.searchParams.get("h"), width);

  const scope = campaignScopeWhereFor(subject);
  const post = Object.keys(scope).length ? { campaign: { orgId: subject.orgId, ...scope } } : undefined;
  return serveThumbnail(await readStoredThumbnail(id, subject.orgId, post), width, height, resizeImage);
}
