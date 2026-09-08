import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { campaignScopeWhereFor } from "@/lib/campaignScope";
import {
  DEFAULT_SHARE_VISIBILITY,
  parseShareVisibility,
  sanitizeShareVisibility,
  type ShareVisibility,
} from "@/lib/reports/shareVisibility";

const SHARE_KIND = "campaign-performance";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

async function findShareLink(orgId: string, campaignId: string) {
  const links = await db.report.findMany({
    where: { orgId, campaignId },
    orderBy: { createdAt: "desc" },
  });
  return links.find((r) => {
    const config = (r.config as { kind?: string } | null) ?? {};
    return config.kind === SHARE_KIND;
  });
}

function serialize(link: { shareToken: string; isPublic: boolean; createdAt: Date; config: unknown }) {
  return {
    token: link.shareToken,
    isPublic: link.isPublic,
    createdAt: link.createdAt.toISOString(),
    path: `/share/${link.shareToken}`,
    visibility: parseShareVisibility(link.config),
  };
}

/** Empty bodies are normal here — "create a link" carries no payload. */
async function readVisibility(req: NextRequest): Promise<ShareVisibility> {
  const body = (await req.json().catch(() => null)) as { visibility?: unknown } | null;
  if (!body || body.visibility === undefined) return DEFAULT_SHARE_VISIBILITY;
  return sanitizeShareVisibility(body.visibility);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { id } = await params;

  /* Row scope, same as GET /api/campaigns/[id]. Creating a public link to a
     campaign is the strongest thing a seat can do with it, so an ASSIGNED seat
     that cannot open the campaign must not be able to read, mint, retarget or
     revoke its share link either. */
  const campaign = await db.campaign.findFirst({
    where: { id, orgId, deletedAt: null, ...campaignScopeWhereFor(result) },
    select: { id: true },
  });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const link = await findShareLink(orgId, id);
  return NextResponse.json({ link: link && link.isPublic ? serialize(link) : null });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId, userId } = result;
  const { id } = await params;

  const campaign = await db.campaign.findFirst({
    where: { id, orgId, deletedAt: null, ...campaignScopeWhereFor(result) },
    select: { id: true, title: true },
  });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const token = randomBytes(32).toString("base64url");
  const existing = await findShareLink(orgId, id);
  const visibility = await readVisibility(req);

  if (existing) {
    const updated = await db.report.update({
      where: { id: existing.id },
      data: { shareToken: token, isPublic: true, config: { kind: SHARE_KIND, visibility } },
    });
    return NextResponse.json({ link: serialize(updated) }, { status: 201 });
  }

  const baseSlug = slugify(`share ${campaign.title}`) || "share";
  let slug = baseSlug;
  let counter = 1;
  while (await db.report.findUnique({ where: { orgId_slug: { orgId, slug } } })) {
    slug = `${baseSlug}-${counter++}`;
  }

  const created = await db.report.create({
    data: {
      orgId,
      campaignId: id,
      title: `${campaign.title} — Performance`,
      slug,
      shareToken: token,
      isPublic: true,
      config: { kind: SHARE_KIND, visibility },
      createdById: userId,
    },
  });

  return NextResponse.json({ link: serialize(created) }, { status: 201 });
}

/**
 * Changes what an existing link shows, without touching the token.
 *
 * Deliberately not POST: that rotates the token, and someone toggling "show
 * budget" is not asking to break a URL they have already emailed to a client.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { id } = await params;

  const campaign = await db.campaign.findFirst({
    where: { id, orgId, deletedAt: null, ...campaignScopeWhereFor(result) },
    select: { id: true },
  });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const link = await findShareLink(orgId, id);
  if (!link || !link.isPublic) {
    return NextResponse.json({ error: "No active share link" }, { status: 404 });
  }

  const visibility = await readVisibility(req);
  const updated = await db.report.update({
    where: { id: link.id },
    data: { config: { kind: SHARE_KIND, visibility } },
  });

  return NextResponse.json({ link: serialize(updated) });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { id } = await params;

  const campaign = await db.campaign.findFirst({
    where: { id, orgId, deletedAt: null, ...campaignScopeWhereFor(result) },
    select: { id: true },
  });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const link = await findShareLink(orgId, id);
  if (link) {
    await db.report.update({ where: { id: link.id }, data: { isPublic: false } });
  }

  return NextResponse.json({ link: null });
}
