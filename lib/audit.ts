import { db } from "./db";
import { getOrgEntitlements } from "@/lib/entitlements";
import { AUDIT_LOG_FEATURE } from "@/lib/featureKeys";

function toJsonValue(value: Record<string, unknown> | null | undefined) {
  if (value == null) return undefined;
  return JSON.parse(JSON.stringify(value));
}

export async function logAudit(params: {
  orgId: string;
  userId?: string;
  actorType?: string;
  actorEmail?: string;
  action: string;
  entityType: string;
  entityId?: string;
  entityLabel?: string;
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}) {
  try {
    const organization = (db as any)?.organization;
    if (!organization?.findUnique) return;

    const entitlements = await getOrgEntitlements(params.orgId);
    if (entitlements?.featureMap[AUDIT_LOG_FEATURE] === false) return;

    const auditLog = (db as any)?.auditLog;
    if (!auditLog?.create) return;

    await db.auditLog.create({
      data: {
        orgId: params.orgId,
        userId: params.userId,
        actorType: params.actorType ?? "user",
        actorEmail: params.actorEmail,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        entityLabel: params.entityLabel,
        ipAddress: params.ipAddress ?? undefined,
        metadata: toJsonValue(params.metadata),
        before: toJsonValue(params.before),
        after: toJsonValue(params.after),
      },
    });
  } catch (e) {
    // Never throw from audit logging
    console.error("Audit log failed:", e);
  }
}

export function createAuditActor(session: { user?: { id?: string | null; email?: string | null } } | null | undefined) {
  return {
    userId: session?.user?.id ?? undefined,
    actorEmail: session?.user?.email ?? undefined,
    actorType: "user",
  };
}
