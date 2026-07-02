import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest, getAuditActor } from "@/lib/authenticate";
import { logAudit } from "@/lib/audit";
import { getRequestIp } from "@/lib/request";

export async function GET(req: NextRequest) {
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
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
  const result = await authenticateRequest(req);
  if (!result) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = result;
  const body = await req.json();
  const { creatorId, campaignId, amount, currency, paymentMethod, recipientPaypalEmail } = body;
  if (!creatorId) return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
  }

  const CURRENCIES = ["USD", "EUR", "GBP", "INR"] as const;
  const PAYMENT_METHODS = ["PAYPAL", "BANK_TRANSFER", "UPI", "NEFT", "IMPS", "RTGS", "ENACH", "WIRE"] as const;
  if (currency != null && !CURRENCIES.includes(currency)) {
    return NextResponse.json({ error: "Invalid currency" }, { status: 400 });
  }
  if (paymentMethod != null && !PAYMENT_METHODS.includes(paymentMethod)) {
    return NextResponse.json({ error: "Invalid payment method" }, { status: 400 });
  }

  const creator = await db.creator.findFirst({ where: { id: creatorId, orgId, deletedAt: null } });
  if (!creator) return NextResponse.json({ error: "Creator not found" }, { status: 404 });
  if (campaignId != null) {
    const campaign = await db.campaign.findFirst({ where: { id: campaignId, orgId, deletedAt: null } });
    if (!campaign) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const payout = await db.payout.create({
    data: { orgId, creatorId, campaignId: campaignId ?? null, amount, currency: currency ?? "USD", paymentMethod: paymentMethod ?? "PAYPAL", recipientPaypalEmail: recipientPaypalEmail ?? null },
  });

  await logAudit({
    orgId,
    ...getAuditActor(result),
    action: "payout.create",
    entityType: "payout",
    entityId: payout.id,
    entityLabel: payout.transactionId ?? payout.id,
    ipAddress: getRequestIp(req),
    after: {
      id: payout.id,
      creatorId: payout.creatorId,
      campaignId: payout.campaignId,
      amount: payout.amount,
      status: payout.status,
    },
  });

  return NextResponse.json(payout, { status: 201 });
}
