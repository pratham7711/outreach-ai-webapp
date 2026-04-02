import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;

  const filter = req.nextUrl.searchParams.get("filter"); // ALL | OVERDUE | THIS_WEEK | UPCOMING | NO_DATE
  const campaignId = req.nextUrl.searchParams.get("campaignId");

  const now = new Date();
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);

  const where: any = {
    campaign: { orgId },
    deletedAt: null,
  };

  if (campaignId) where.campaignId = campaignId;

  if (filter === "OVERDUE") {
    where.deliverableDueDate = { lt: now };
    where.NOT = { status: { in: ["COMPLETE", "DECLINED"] } };
  } else if (filter === "THIS_WEEK") {
    where.deliverableDueDate = { gte: now, lte: weekEnd };
  } else if (filter === "UPCOMING") {
    where.deliverableDueDate = { gt: weekEnd };
  } else if (filter === "NO_DATE") {
    where.deliverableDueDate = null;
  } else {
    // ALL: return everything (with and without due dates)
  }

  const activations = await db.activation.findMany({
    where,
    select: {
      id: true,
      status: true,
      deliverableDueDate: true,
      feedbackNotes: true,
      creator: { select: { id: true, name: true, handle: true, platform: true } },
      campaign: { select: { id: true, title: true, status: true } },
    },
    orderBy: [
      { deliverableDueDate: "asc" },
      { createdAt: "desc" },
    ],
  });

  // Compute summary counts for stat cards
  const allActivations = await db.activation.findMany({
    where: { campaign: { orgId }, deletedAt: null },
    select: { deliverableDueDate: true, status: true },
  });

  const total = allActivations.filter(a => a.deliverableDueDate !== null).length;
  const overdue = allActivations.filter(a =>
    a.deliverableDueDate && new Date(a.deliverableDueDate) < now &&
    !["COMPLETE", "DECLINED"].includes(a.status)
  ).length;
  const dueThisWeek = allActivations.filter(a =>
    a.deliverableDueDate &&
    new Date(a.deliverableDueDate) >= now &&
    new Date(a.deliverableDueDate) <= weekEnd
  ).length;
  const completed = allActivations.filter(a => a.status === "COMPLETE").length;
  const noDate = allActivations.filter(a => a.deliverableDueDate === null).length;

  return NextResponse.json({
    activations,
    stats: { total, overdue, dueThisWeek, completed, noDate },
  });
}
