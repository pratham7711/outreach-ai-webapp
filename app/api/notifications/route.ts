import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import {
  NOTIFIABLE_ACTIONS,
  NOTIFICATION_FEED_LIMIT,
  NOTIFICATION_LOOKBACK_DAYS,
} from "@/lib/notificationFeed";

/**
 * The top bar's bell. Reads the org's own AuditLog, narrowed to the actions in
 * the notification catalog — see lib/notificationFeed.ts for why there is no
 * Notification table.
 *
 * Deliberately not gated the way /api/audit-logs is. That route is a compliance
 * surface: it needs the audit_log entitlement, refuses VIEWERs, and returns IP
 * addresses and before/after diffs. This one returns "Campaign Created — Summer
 * Drop" and a timestamp, which every member of the org can already read off the
 * campaigns list.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string | undefined;
  if (!orgId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const sinceParam = new URL(req.url).searchParams.get("since");
  const sinceDate = sinceParam ? new Date(sinceParam) : null;
  const since = sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : null;

  const floor = new Date(Date.now() - NOTIFICATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const where = {
    orgId,
    action: { in: NOTIFIABLE_ACTIONS },
    createdAt: { gte: floor },
  };

  const [logs, unreadCount] = await Promise.all([
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: NOTIFICATION_FEED_LIMIT,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        entityLabel: true,
        createdAt: true,
      },
    }),
    /* No last-seen marker means the browser has never opened the bell, so
       everything in the window is genuinely unseen by this device. */
    db.auditLog.count({
      where: since ? { ...where, createdAt: { gte: since > floor ? since : floor } } : where,
    }),
  ]);

  return Response.json({
    items: logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    unreadCount,
  });
}
