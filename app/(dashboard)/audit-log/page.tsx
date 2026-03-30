import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOrgEntitlements, hasOrgFeature } from "@/lib/entitlements";
import { AUDIT_LOG_FEATURE } from "@/lib/featureKeys";
import { Badge, Card, EmptyState } from "@pratham7711/ui";
import AuditLogClient from "./AuditLogClient";

const PAGE_SIZE = 20;

export default async function AuditLogPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).orgId as string;
  const entitlements = await getOrgEntitlements(orgId);
  if (!entitlements) redirect("/login");

  const auditLogEnabled = hasOrgFeature(entitlements, AUDIT_LOG_FEATURE);

  if (!auditLogEnabled) {
    return (
      <div className="cc-page-content">
        <div style={{ marginBottom: 32 }}>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: "var(--cc-text)", marginBottom: 4 }}>
            Audit Log
          </h1>
          <p style={{ fontSize: 14, color: "var(--cc-text-muted)" }}>
            Track changes across your organization
          </p>
        </div>

        <Card variant="outlined" noPadding>
          <div style={{ padding: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <Badge variant="warning" size="sm">
                Disabled
              </Badge>
              <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
                Audit logging is currently turned off for this workspace
              </span>
            </div>

            <EmptyState
              icon="🔒"
              title="Audit log is turned off"
              description="Enable audit logging in Billing to start capturing workspace changes and viewing them here."
              action={
                <Link
                  href="/settings/billing"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: "10px 16px",
                    borderRadius: 10,
                    background: "var(--cc-primary)",
                    color: "white",
                    fontSize: 14,
                    fontWeight: 600,
                    textDecoration: "none",
                    boxShadow: "0 8px 18px rgba(79, 70, 229, 0.18)",
                  }}
                >
                  Open Billing
                </Link>
              }
            />
          </div>
        </Card>
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
