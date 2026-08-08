import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";
import { z } from "zod";
import { dateParam, parseQuery } from "@/lib/http/queryParams";

const auditLogsCsvQuerySchema = z.object({
  action: z.string().trim().optional(),
  entityType: z.string().trim().optional(),
  q: z.string().trim().optional(),
  from: dateParam.optional(),
  to: dateParam.optional(),
});

function escapeCSV(val: unknown): string {
  if (val == null) return "";
  const s = String(val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export async function GET(req: NextRequest) {
  const auth = await authenticateRequest(req);
  if (!auth) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const { orgId } = auth;

  const parsedQuery = parseQuery(auditLogsCsvQuerySchema, new URL(req.url).searchParams);
  if (!parsedQuery.ok) return parsedQuery.response;
  const { action, entityType, q, from, to } = parsedQuery.data;

  const where: any = {
    orgId,
    ...(action && { action }),
    ...(entityType && { entityType }),
    ...(q && {
      OR: [
        { entityLabel: { contains: q, mode: "insensitive" } },
        { actorEmail: { contains: q, mode: "insensitive" } },
        { ipAddress: { contains: q } },
      ],
    }),
    ...((from || to) && {
      createdAt: {
        ...(from && { gte: from }),
        ...(to && { lte: to }),
      },
    }),
  };

  const logs = await db.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      actorEmail: true,
      actorType: true,
      action: true,
      entityType: true,
      entityLabel: true,
      entityId: true,
      ipAddress: true,
    },
  });

  const header = "timestamp,actorEmail,actorType,action,entityType,entityLabel,entityId,ipAddress\n";
  const rows = logs
    .map((l) =>
      [
        l.createdAt.toISOString(),
        l.actorEmail,
        l.actorType,
        l.action,
        l.entityType,
        l.entityLabel,
        l.entityId,
        l.ipAddress,
      ]
        .map(escapeCSV)
        .join(",")
    )
    .join("\n");

  return new Response(header + rows, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": 'attachment; filename="audit-log.csv"',
    },
  });
}
