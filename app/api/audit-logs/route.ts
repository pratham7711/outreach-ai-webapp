import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { getOrgEntitlements } from "@/lib/entitlements";

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

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10)));
  const action = searchParams.get("action")?.trim() || undefined;
  const entityType = searchParams.get("entityType")?.trim() || undefined;
  const actorEmail = searchParams.get("actorEmail")?.trim() || undefined;
  const q = searchParams.get("q")?.trim() || undefined;
  const from = searchParams.get("from") ? new Date(searchParams.get("from")!) : undefined;
  const to = searchParams.get("to") ? new Date(searchParams.get("to")!) : undefined;

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
