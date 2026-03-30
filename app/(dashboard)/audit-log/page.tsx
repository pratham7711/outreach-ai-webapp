import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import AuditLogClient from "./AuditLogClient";

const PAGE_SIZE = 20;

export default async function AuditLogPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).orgId as string;

  const [logs, total] = await Promise.all([
    db.auditLog.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
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
    db.auditLog.count({ where: { orgId } }),
  ]);

  return (
    <AuditLogClient
      initialLogs={logs.map((log) => ({
        ...log,
        createdAt: log.createdAt.toISOString(),
      }))}
      initialPagination={{
        page: 1,
        pageSize: PAGE_SIZE,
        total,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
      }}
    />
  );
}
