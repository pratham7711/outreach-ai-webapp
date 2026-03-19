import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";

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

  const reports = await db.report.findMany({
    where: { orgId },
    include: { campaign: { select: { id: true, title: true } } },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json(reports);
}

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = (session.user as any).orgId as string;
  const userId = session.user.id!;

  const body = await request.json();
  const { title, campaignId, isPublic, config } = body;

  if (!title || typeof title !== "string") {
    return NextResponse.json({ error: "Title is required" }, { status: 400 });
  }

  const baseSlug = slugify(title);
  let slug = baseSlug;
  let counter = 1;
  while (await db.report.findUnique({ where: { orgId_slug: { orgId, slug } } })) {
    slug = `${baseSlug}-${counter++}`;
  }

  const report = await db.report.create({
    data: {
      orgId,
      title,
      slug,
      campaignId: campaignId ?? null,
      isPublic: isPublic ?? false,
      config: config ?? {},
      createdById: userId,
    },
    include: { campaign: { select: { id: true, title: true } } },
  });

  return NextResponse.json(report, { status: 201 });
}
