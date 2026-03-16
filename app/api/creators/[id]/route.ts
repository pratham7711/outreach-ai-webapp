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
    const creator = await db.creator.findUnique({
      where: { id },
      include: {
        activations: { include: { campaign: { select: { id: true, title: true, status: true, budget: true, currency: true } } } },
        posts: { orderBy: { postedAt: "desc" }, take: 20 },
        payouts: { orderBy: { createdAt: "desc" }, take: 10 },
        _count: { select: { activations: true, posts: true } },
      },
    });
    if (!creator || creator.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });
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
