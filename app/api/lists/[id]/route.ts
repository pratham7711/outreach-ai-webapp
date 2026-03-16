import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const list = await db.creatorList.findUnique({ where: { id }, include: { items: { include: { creator: true } } } });
  if (!list) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ list });
}
