import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";
import { AUDIT_LOG_FEATURE } from "@/lib/featureKeys";
import AuditLogClient from "./AuditLogClient";
import { FeatureState, PageHeader } from "@/components/ds";
import { AUDIT_LOG_PAGE_SIZE as PAGE_SIZE } from "./columns";

export default async function AuditLogPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).orgId as string;
  const entitlements = await getOrgEntitlements(orgId);
  if (!entitlements) redirect("/login");

  const auditLogEnabled = hasOrgFeature(entitlements, AUDIT_LOG_FEATURE);

  if (!auditLogEnabled) {
    return (
      <div className="rsp-page page-enter">
        <PageHeader title="Audit log" subtitle="Track changes across your organization" />

        <FeatureState
          kind="locked"
          title="Audit log is turned off"
          body="Audit logging is off for this workspace, so changes are not being recorded. Ask a workspace owner to turn it on."
        />
      </div>
    );
  }

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
