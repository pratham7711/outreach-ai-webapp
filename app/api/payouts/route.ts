import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const { searchParams } = req.nextUrl;
  const status = searchParams.get("status");
  const page = parseInt(searchParams.get("page") ?? "1");
  const limit = parseInt(searchParams.get("limit") ?? "20");
  const skip = (page - 1) * limit;
  const where = { orgId, ...(status && { status: status as any }) };
  const [payouts, total, balance] = await Promise.all([
    db.payout.findMany({ where, include: { creator: { select: { id: true, name: true, handle: true, platform: true } }, campaign: { select: { id: true, title: true } } }, orderBy: { createdAt: "desc" }, skip, take: limit }),
    db.payout.count({ where }),
    db.payoutBalance.findFirst({ where: { orgId } }),
  ]);
  return NextResponse.json({ payouts, balance, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;
  const body = await req.json();
  const { creatorId, campaignId, amount, currency, paymentMethod, recipientPaypalEmail } = body;
  if (!creatorId || !amount) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  const payout = await db.payout.create({
    data: { orgId, creatorId, campaignId: campaignId ?? null, amount, currency: currency ?? "USD", paymentMethod: paymentMethod ?? "PAYPAL", recipientPaypalEmail: recipientPaypalEmail ?? null },
  });
  return NextResponse.json(payout, { status: 201 });
}
