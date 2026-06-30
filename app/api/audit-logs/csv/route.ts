import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { authenticateRequest } from "@/lib/authenticate";

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

  const { searchParams } = new URL(req.url);
  const action = searchParams.get("action")?.trim() || undefined;
  const entityType = searchParams.get("entityType")?.trim() || undefined;
  const q = searchParams.get("q")?.trim() || undefined;
  const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : undefined;
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : undefined;

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
