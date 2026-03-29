import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const orgId = (session.user as any).orgId;
    const creator = await db.creator.findFirst({
      where: { id, orgId, deletedAt: null },
      include: {
        activations: {
          where: { deletedAt: null },
          include: {
            campaign: { select: { id: true, title: true, status: true, budget: true, currency: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        posts: {
          include: { campaign: { select: { id: true, title: true } } },
          orderBy: { postedAt: "desc" },
          take: 50,
        },
        payouts: {
          include: { campaign: { select: { id: true, title: true } } },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
        _count: { select: { activations: true, posts: true, payouts: true } },
      },
    });
    if (!creator) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(creator);
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id } = await params;
    const body = await req.json();
    const creator = await db.creator.update({ where: { id }, data: body });
    return NextResponse.json(creator);
  } catch (e) {
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
