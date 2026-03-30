import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";

type ExportType = "payouts" | "campaigns" | "creators";

function escapeCsv(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildCsv(headers: string[], rows: string[][]): string {
  const headerLine = headers.map(escapeCsv).join(",");
  const dataLines = rows.map((row) => row.map(escapeCsv).join(","));
  return [headerLine, ...dataLines].join("\n");
}

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const orgId = (session.user as any).orgId;

    const { searchParams } = request.nextUrl;
    const now = new Date();
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const from = searchParams.get("from")
      ? new Date(searchParams.get("from")!)
      : sixMonthsAgo;
    const to = searchParams.get("to")
      ? new Date(searchParams.get("to")!)
      : now;
    const type = (searchParams.get("type") || "payouts") as ExportType;

    let csvContent: string;

    if (type === "payouts") {
      const payouts = await db.payout.findMany({
        where: {
          orgId,
          createdAt: { gte: from, lte: to },
        },
        include: {
          creator: { select: { name: true, handle: true } },
          campaign: { select: { title: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      const headers = [
        "Date",
        "Creator",
        "Campaign",
        "Amount",
        "Currency",
        "Status",
        "Payment Method",
        "Transaction ID",
      ];
      const rows = payouts.map((p) => [
        p.createdAt.toISOString().split("T")[0],
        p.creator.name,
        p.campaign?.title ?? "",
        String(p.amount),
        p.currency,
        p.status,
        p.paymentMethod,
        p.transactionId ?? "",
      ]);

      csvContent = buildCsv(headers, rows);
    } else if (type === "campaigns") {
      const campaigns = await db.campaign.findMany({
        where: {
          orgId,
          deletedAt: null,
          createdAt: { gte: from, lte: to },
        },
        include: {
          client: { select: { name: true } },
          payouts: { select: { amount: true } },
          activations: { select: { id: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      const headers = [
        "Campaign",
        "Client",
        "Budget",
        "Total Spent",
        "Status",
        "Creators",
        "Start Date",
      ];
      const rows = campaigns.map((c) => {
        const totalSpent = c.payouts.reduce((sum, p) => sum + p.amount, 0);
        return [
          c.title,
          c.client?.name ?? "",
          c.budget != null ? String(c.budget) : "",
          String(totalSpent),
          c.status,
          String(c.activations.length),
          c.createdAt.toISOString().split("T")[0],
        ];
      });

      csvContent = buildCsv(headers, rows);
    } else if (type === "creators") {
      const creators = await db.creator.findMany({
        where: {
          orgId,
          deletedAt: null,
        },
        include: {
          payouts: {
            where: { createdAt: { gte: from, lte: to } },
            select: { amount: true },
          },
          activations: { select: { id: true } },
        },
        orderBy: { name: "asc" },
      });

      const headers = [
        "Creator",
        "Handle",
        "Platform",
        "Total Paid",
        "Activations",
        "Avg Engagement",
      ];
      const rows = creators.map((c) => {
        const totalPaid = c.payouts.reduce((sum, p) => sum + p.amount, 0);
        return [
          c.name,
          c.handle,
          c.platform,
          String(totalPaid),
          String(c.activations.length),
          String(c.averageViews),
        ];
      });

      csvContent = buildCsv(headers, rows);
    } else {
      return NextResponse.json(
        { error: "Invalid type. Must be payouts, campaigns, or creators." },
        { status: 400 }
      );
    }

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="financial-report-${type}-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error("Financial export error:", error);
    return NextResponse.json(
      { error: "Failed to export financial data" },
      { status: 500 }
    );
  }
}
