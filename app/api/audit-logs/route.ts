import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getOrgEntitlements } from "@/lib/entitlements";
import { z } from "zod";
import { dateParam, pageParam, pageSizeParam, parseQuery } from "@/lib/http/queryParams";

const auditLogsQuerySchema = z.object({
  page: pageParam,
  pageSize: pageSizeParam(),
  action: z.string().trim().optional(),
  entityType: z.string().trim().optional(),
  actorEmail: z.string().trim().optional(),
  q: z.string().trim().optional(),
  from: dateParam.optional(),
  to: dateParam.optional(),
});

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string;

  // Role check — only ADMIN and MEMBER can access audit logs
  const role = (session.user as any).role;
  if (role === "VIEWER") return Response.json({ error: "Forbidden" }, { status: 403 });

  // Entitlement check
  const entitlements = await getOrgEntitlements(orgId);
  if (!entitlements?.featureMap.audit_log) return Response.json({ error: "Audit log not enabled for this plan" }, { status: 403 });

  const parsedQuery = parseQuery(auditLogsQuerySchema, new URL(req.url).searchParams);
  if (!parsedQuery.ok) return parsedQuery.response;
  const { page, pageSize, action, entityType, actorEmail, q, from, to } = parsedQuery.data;

  const where: any = {
    orgId,
    ...(action && { action }),
    ...(entityType && { entityType }),
    ...(actorEmail && { actorEmail: { contains: actorEmail, mode: "insensitive" } }),
    ...(q && {
      OR: [
        { entityLabel: { contains: q, mode: "insensitive" } },
        { actorEmail: { contains: q, mode: "insensitive" } },
        { ipAddress: { contains: q } },
        ...(actorEmail ? [{ actorEmail: { contains: actorEmail, mode: "insensitive" } }] : []),
      ],
    }),
    ...((from || to) && {
      createdAt: {
        ...(from && { gte: from }),
        ...(to && { lte: to }),
      },
    }),
  };

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        entityLabel: true,
        actorType: true,
        actorEmail: true,
        ipAddress: true,
        metadata: true,
        before: true,
        after: true,
        createdAt: true,
      },
    }),
    db.auditLog.count({ where }),
  ]);

  return Response.json({
    logs: logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
}
