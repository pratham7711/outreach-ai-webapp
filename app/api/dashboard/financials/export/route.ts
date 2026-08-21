import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { dateParam, parseQuery } from "@/lib/http/queryParams";

const financialsExportQuerySchema = z.object({
  from: dateParam.optional(),
  to: dateParam.optional(),
  type: z.enum(["campaigns", "creators"]).default("campaigns"),
});

type ExportType = "campaigns" | "creators";

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

    const parsedQuery = parseQuery(financialsExportQuerySchema, searchParams);
    if (!parsedQuery.ok) return parsedQuery.response;
    const from = parsedQuery.data.from ?? sixMonthsAgo;
    const to = parsedQuery.data.to ?? now;
    const type: ExportType = parsedQuery.data.type;

    let csvContent: string;

    if (type === "campaigns") {
      const campaigns = await db.campaign.findMany({
        where: {
          orgId,
          deletedAt: null,
          createdAt: { gte: from, lte: to },
        },
        include: {
          client: { select: { name: true } },
          activations: { select: { id: true } },
        },
        orderBy: { createdAt: "desc" },
      });

      const headers = [
        "Campaign",
        "Client",
        "Status",
        "Creators",
        "Start Date",
      ];
      const rows = campaigns.map((c) => [
        c.title,
        c.client?.name ?? "",
        c.status,
        String(c.activations.length),
        c.createdAt.toISOString().split("T")[0],
      ]);

      csvContent = buildCsv(headers, rows);
    } else if (type === "creators") {
      const creators = await db.creator.findMany({
        where: {
          orgId,
          deletedAt: null,
        },
        include: {
          activations: { select: { id: true } },
        },
        orderBy: { name: "asc" },
      });

      // Average views is derived from the posts themselves. The stored
      // Creator.averageViews column is 0 on all but one creator, and the header
      // used to read "Avg Engagement" while carrying that views number.
      const grouped = creators.length
        ? await db.post.groupBy({
            by: ["creatorId"],
            where: { creatorId: { in: creators.map((c) => c.id) }, viewsCount: { gt: 0 } },
            _avg: { viewsCount: true },
          })
        : [];
      const avgViews = new Map(
        grouped
          .filter((g) => g._avg.viewsCount !== null)
          .map((g) => [g.creatorId, Math.round(g._avg.viewsCount as number)])
      );

      const headers = [
        "Creator",
        "Handle",
        "Platform",
        "Activations",
        "Avg Views",
      ];
      const rows = creators.map((c) => [
        c.name,
        c.handle,
        c.platform,
        String(c.activations.length),
        avgViews.has(c.id) ? String(avgViews.get(c.id)) : "",
      ]);

      csvContent = buildCsv(headers, rows);
    } else {
      return NextResponse.json(
        { error: "Invalid type. Must be campaigns or creators." },
        { status: 400 }
      );
    }

    return new NextResponse(csvContent, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="campaign-report-${type}-${new Date().toISOString().split("T")[0]}.csv"`,
      },
    });
  } catch (error) {
    console.error("Report export error:", error);
    return NextResponse.json(
      { error: "Failed to export financial data" },
      { status: 500 }
    );
  }
}
