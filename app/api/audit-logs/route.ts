import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { hasPermission } from "@/lib/rbac";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const role = (session.user as any).role as string;
    if (!hasPermission(role, "settings:*") && !hasPermission(role, "reports:*")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const orgId = (session.user as any).orgId as string;
    const { searchParams } = request.nextUrl;

    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(
      MAX_PAGE_SIZE,
      Math.max(1, parseInt(searchParams.get("pageSize") ?? String(DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE)
    );
    const skip = (page - 1) * pageSize;

    const action = searchParams.get("action")?.trim();
    const entityType = searchParams.get("entityType")?.trim();
    const actorEmail = searchParams.get("actorEmail")?.trim();
    const q = searchParams.get("q")?.trim();

    const where: any = { orgId };
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (actorEmail) {
      where.actorEmail = { contains: actorEmail, mode: "insensitive" as const };
    }
    if (q) {
      where.OR = [
        { action: { contains: q, mode: "insensitive" as const } },
        { entityType: { contains: q, mode: "insensitive" as const } },
        { entityLabel: { contains: q, mode: "insensitive" as const } },
        { actorEmail: { contains: q, mode: "insensitive" as const } },
      ];
    }

    const [logs, total] = await Promise.all([
      db.auditLog.findMany({
        where,
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
        orderBy: { createdAt: "desc" },
        skip,
        take: pageSize,
      }),
      db.auditLog.count({ where }),
    ]);

    return NextResponse.json({
      logs,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      },
    });
  } catch (error) {
    console.error("GET /api/audit-logs error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
