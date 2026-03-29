import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId;

  const month = req.nextUrl.searchParams.get("month"); // YYYY-MM
  if (!month) return NextResponse.json({ error: "month param required (YYYY-MM)" }, { status: 400 });

  const [year, m] = month.split("-").map(Number);
  const startOfMonth = new Date(year, m - 1, 1);
  const endOfMonth = new Date(year, m, 0, 23, 59, 59);

  const [campaigns, activations] = await Promise.all([
    db.campaign.findMany({
      where: {
        orgId,
        deletedAt: null,
        createdAt: { lte: endOfMonth },
      },
      select: {
        id: true, title: true, status: true, createdAt: true, updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    }),
    db.activation.findMany({
      where: {
        campaign: { orgId },
        deletedAt: null,
        deliverableDueDate: { gte: startOfMonth, lte: endOfMonth },
      },
      select: {
        id: true, status: true, deliverableDueDate: true,
        creator: { select: { id: true, name: true } },
        campaign: { select: { id: true, title: true } },
      },
    }),
  ]);

  return NextResponse.json({ campaigns, activations });
}
