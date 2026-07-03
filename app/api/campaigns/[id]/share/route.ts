import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";

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

function serialize(link: { shareToken: string; isPublic: boolean; createdAt: Date }) {
  return {
    token: link.shareToken,
    isPublic: link.isPublic,
    createdAt: link.createdAt.toISOString(),
    path: `/share/${link.shareToken}`,
  };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const { id } = await params;

  const campaign = await db.campaign.findFirst({
    where: { id, orgId, deletedAt: null },
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
    where: { id, orgId, deletedAt: null },
    select: { id: true, title: true },
  });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const token = randomBytes(32).toString("base64url");
  const existing = await findShareLink(orgId, id);

  if (existing) {
    const updated = await db.report.update({
      where: { id: existing.id },
      data: { shareToken: token, isPublic: true },
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
      config: { kind: SHARE_KIND },
      createdById: userId,
    },
  });

  return NextResponse.json({ link: serialize(created) }, { status: 201 });
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
    where: { id, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

  const link = await findShareLink(orgId, id);
  if (link) {
    await db.report.update({ where: { id: link.id }, data: { isPublic: false } });
  }

  return NextResponse.json({ link: null });
}
