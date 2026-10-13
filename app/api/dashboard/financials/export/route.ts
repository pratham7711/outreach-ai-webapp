import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { z } from "zod";
import { dateParam, parseQuery } from "@/lib/http/queryParams";
import { deriveAverageViewsMeasured } from "@/lib/creatorMetrics";
import { asOfCell } from "@/lib/dataAge";
import { UNKNOWN } from "@/lib/format";
import { UNATTRIBUTED_CREATOR_WHERE } from "@/lib/posts/unattributedName";

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
    // UTC, matching the route this exports. Not a view on whether defaults
    // should be user-local -- that is open -- but the export must cover the same
    // window as the screen, and a UTC screen with a local export does not.
    const sixMonthsAgo = new Date(now);
    sixMonthsAgo.setUTCMonth(sixMonthsAgo.getUTCMonth() - 6);

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
          /* The Unattributed holding row is a filing label, not a creator --
             the dashboard's creator table no longer lists it either. */
          NOT: UNATTRIBUTED_CREATOR_WHERE,
        },
        include: {
          activations: { select: { id: true } },
        },
        orderBy: { name: "asc" },
      });

      // Average views is derived from the posts themselves. The stored
      // Creator.averageViews column is 0 on all but one creator, and the header
      // used to read "Avg Engagement" while carrying that views number.
      // The same query the roster uses, which also dates the mean (plan A6).
      const avgViews = await deriveAverageViewsMeasured(creators.map((c) => c.id));

      /* As of and Source are appended so the existing columns keep their
         positions. A creator with no measured post is "—" (lib/creators/
         metricValue's export rule), not an empty cell that reads as a load
         failure. */
      const headers = [
        "Creator",
        "Handle",
        "Platform",
        "Activations",
        "Avg Views",
        "Avg Views as of",
        "Avg Views source",
      ];
      const rows = creators.map((c) => {
        const avg = avgViews.get(c.id);
        return [
          c.name,
          c.handle,
          c.platform,
          String(c.activations.length),
          avg ? String(avg.value) : UNKNOWN,
          asOfCell(avg?.asOf ?? null),
          avg ? avg.source : "No measured posts",
        ];
      });

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
