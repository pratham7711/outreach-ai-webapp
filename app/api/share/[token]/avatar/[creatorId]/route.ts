import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { imageDimension, resizeImage } from "@/lib/media/proxyImage";
import { readStoredAvatar } from "@/lib/creators/avatarStore";
import { serveAvatar } from "@/lib/creators/avatarResponse";
import { parseShareVisibility } from "@/lib/reports/shareVisibility";

export const runtime = "nodejs";

const SHARE_KIND = "campaign-performance";
const TTL_MS = 60_000;

/*
  The client report's creator pictures, for a viewer with no session.

  A live link may only show creators on its own campaign, so the link is
  resolved once to the set of creator ids with a post or activation there and
  that set is remembered briefly. The report fires two dozen of these at once,
  and a lookup per image is what once made Neon's pooler answer P1001 (see the
  sibling img route). The lookup itself is what is remembered, so the first
  burst shares one query rather than each missing the cache together.
*/
type Creators = { orgId: string | null; ids: Set<string> };
const allowed = new Map<string, { at: number; creators: Promise<Creators> }>();

function creatorsOnLink(token: string): Promise<Creators> {
  const now = Date.now();
  const seen = allowed.get(token);
  if (seen && now - seen.at < TTL_MS) return seen.creators;
  const creators = lookUp(token);
  // A failed lookup is not an answer; the next picture asks again.
  creators.catch(() => allowed.get(token)?.creators === creators && allowed.delete(token));
  if (allowed.size > 500) allowed.clear();
  allowed.set(token, { at: now, creators });
  return creators;
}

async function lookUp(token: string): Promise<Creators> {
  const link = await db.report.findUnique({
    where: { shareToken: token },
    select: { isPublic: true, config: true, orgId: true, campaignId: true },
  });
  const config = (link?.config as { kind?: string } | null) ?? {};
  // A link that hides creators hides their faces too.
  const showsCreators = parseShareVisibility(link?.config).showCreators;
  if (!(link?.isPublic && config.kind === SHARE_KIND && link.campaignId && showsCreators)) return { orgId: null, ids: new Set() };
  const [posts, activations] = await Promise.all([
    db.post.findMany({
      where: { campaignId: link.campaignId, campaign: { orgId: link.orgId } },
      select: { creatorId: true },
      distinct: ["creatorId"],
    }),
    db.activation.findMany({
      where: { campaignId: link.campaignId, campaign: { orgId: link.orgId } },
      select: { creatorId: true },
      distinct: ["creatorId"],
    }),
  ]);
  return { orgId: link.orgId, ids: new Set([...posts, ...activations].map((r) => r.creatorId)) };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string; creatorId: string }> }
) {
  const { token, creatorId } = await params;
  const link = await creatorsOnLink(token);
  if (!link.orgId || !link.ids.has(creatorId)) return new NextResponse("not found", { status: 404 });

  const width = imageDimension(req.nextUrl.searchParams.get("w"), 96);
  return serveAvatar(await readStoredAvatar(creatorId, link.orgId), width, resizeImage);
}
