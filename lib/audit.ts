import { db } from "./db";

export async function logAudit(params: {
  orgId: string;
  userId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.auditLog.create({
      data: {
        ...params,
        metadata: params.metadata != null ? JSON.stringify(params.metadata) : undefined,
      },
    });
  } catch (e) {
    // Never throw from audit logging
    console.error("Audit log failed:", e);
  }
}
