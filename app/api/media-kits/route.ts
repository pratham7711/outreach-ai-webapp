import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId as string;
  const entitlements = await getOrgEntitlements(orgId);
  if (!hasOrgFeature(entitlements, "media_kits")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const kits = await db.mediaKit.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(kits);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId as string;
  const userId = session.user.id!;
  const entitlements = await getOrgEntitlements(orgId);
  if (!hasOrgFeature(entitlements, "media_kits")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json();
  const { title, creatorIds, config } = body;

  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const baseSlug = slugify(title);
  let slug = baseSlug;
  let counter = 1;
  while (await db.mediaKit.findUnique({ where: { orgId_slug: { orgId, slug } } })) {
    slug = `${baseSlug}-${counter++}`;
  }

  const kit = await db.mediaKit.create({
    data: {
      orgId,
      title,
      slug,
      creatorIds: creatorIds ?? [],
      config: config ?? {},
      createdById: userId,
    },
  });

  return NextResponse.json(kit, { status: 201 });
}
