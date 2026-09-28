import { NextRequest, NextResponse } from "next/server";
import { imageDimension, resizeImage } from "@/lib/media/proxyImage";
import { readStoredAvatar } from "@/lib/creators/avatarStore";
import { serveAvatar } from "@/lib/creators/avatarResponse";
import { loadListShare, sharedListMemberIds } from "@/lib/lists/listShare";

export const runtime = "nodejs";

const TTL_MS = 60_000;

/*
  A shared list's creator pictures, for a viewer with no session.

  A link may only show faces on its own list, so it is resolved once to the
  member ids and that set is remembered briefly -- the page fires a picture per
  card at once, and a lookup per image is what once made Neon's pooler answer
  P1001 (see app/api/share/[token]/avatar). The lookup itself is what is
  remembered, so the first burst shares one query rather than each missing the
  cache together. A revoke is noticed within a minute.
*/
type Members = { orgId: string | null; ids: Set<string> };
const allowed = new Map<string, { at: number; members: Promise<Members> }>();

async function lookUp(token: string): Promise<Members> {
  const share = await loadListShare(token);
  return share ? { orgId: share.orgId, ids: await sharedListMemberIds(share) } : { orgId: null, ids: new Set() };
}

function membersOf(token: string): Promise<Members> {
  const now = Date.now();
  const seen = allowed.get(token);
  if (seen && now - seen.at < TTL_MS) return seen.members;
  const members = lookUp(token);
  // A failed lookup is not an answer; the next picture asks again.
  members.catch(() => allowed.get(token)?.members === members && allowed.delete(token));
  if (allowed.size > 500) allowed.clear();
  allowed.set(token, { at: now, members });
  return members;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string; creatorId: string }> }) {
  const { token, creatorId } = await params;
  const link = await membersOf(token);
  if (!link.orgId || !link.ids.has(creatorId)) return new NextResponse("not found", { status: 404 });

  const width = imageDimension(req.nextUrl.searchParams.get("w"), 96);
  return serveAvatar(await readStoredAvatar(creatorId, link.orgId), width, resizeImage);
}
