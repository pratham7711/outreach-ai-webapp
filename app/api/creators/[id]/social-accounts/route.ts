import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

// ─── GET — list social accounts (secrets excluded) ───────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id } = await params;

  const creator = await db.creator.findFirst({
    where: { id, orgId, deletedAt: null },
  });
  if (!creator)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const accounts = await db.creatorSocialAccount.findMany({
    where: { creatorId: id },
    select: {
      id: true,
      platform: true,
      handle: true,
      followersCount: true,
      avgViews: true,
      tokenExpiry: true,
      createdAt: true,
      updatedAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json(accounts);
}

// ─── POST — add a social account ─────────────────────────────────────────────

const PostSchema = z.object({
  platform: z.enum(["TIKTOK", "INSTAGRAM", "YOUTUBE", "TWITTER"]),
  handle: z.string().min(1).max(100),
  accessToken: z.string().min(1).default("manual-entry"),
  refreshToken: z.string().optional().nullable(),
  followersCount: z.number().int().min(0).optional(),
  avgViews: z.number().int().min(0).optional(),
});

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id } = await params;

  const creator = await db.creator.findFirst({
    where: { id, orgId, deletedAt: null },
  });
  if (!creator)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const body = await req.json();
    const parsed = PostSchema.safeParse(body);
    if (!parsed.success)
      return NextResponse.json(
        { error: "Invalid input", details: parsed.error.flatten() },
        { status: 400 },
      );

    const account = await db.creatorSocialAccount.create({
      data: { creatorId: id, ...parsed.data },
    });

    // Strip secrets before returning
    const { accessToken, refreshToken, ...safe } = account as any;
    return NextResponse.json(safe, { status: 201 });
  } catch (err: any) {
    if (err?.code === "P2002")
      return NextResponse.json(
        { error: "This platform is already linked" },
        { status: 409 },
      );
    console.error("Failed to add social account:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}

// ─── DELETE — remove a social account ────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { id } = await params;

  const creator = await db.creator.findFirst({
    where: { id, orgId, deletedAt: null },
  });
  if (!creator)
    return NextResponse.json({ error: "Not found" }, { status: 404 });

  const accountId = req.nextUrl.searchParams.get("accountId");
  if (!accountId)
    return NextResponse.json(
      { error: "accountId required" },
      { status: 400 },
    );

  const account = await db.creatorSocialAccount.findFirst({
    where: { id: accountId, creatorId: id },
  });
  if (!account)
    return NextResponse.json(
      { error: "Account not found" },
      { status: 404 },
    );

  await db.creatorSocialAccount.delete({ where: { id: accountId } });
  return NextResponse.json({ success: true });
}
