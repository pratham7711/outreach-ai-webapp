import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const lists = await db.creatorList.findMany({ where: { orgId }, include: { _count: { select: { items: true } } }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ lists });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { name, description } = await req.json();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const list = await db.creatorList.create({ data: { orgId, name, description: description ?? null } });
  return NextResponse.json(list, { status: 201 });
}
