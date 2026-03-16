import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = req.nextUrl;
  const campaignId = searchParams.get("campaignId");
  const where = { ...(campaignId && { campaignId }), deletedAt: null };
  const activations = await db.activation.findMany({ where, include: { creator: { select: { id: true, name: true, handle: true, platform: true, avatarUrl: true } }, campaign: { select: { id: true, title: true } } }, orderBy: { createdAt: "desc" } });
  return NextResponse.json({ activations });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { campaignId, creatorId, deliverableDueDate } = await req.json();
  if (!campaignId || !creatorId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  const activation = await db.activation.create({
    data: { campaignId, creatorId, deliverableDueDate: deliverableDueDate ? new Date(deliverableDueDate) : null },
  });
  return NextResponse.json(activation, { status: 201 });
}
