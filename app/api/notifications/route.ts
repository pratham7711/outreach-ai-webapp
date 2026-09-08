import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import {
  NOTIFIABLE_ACTIONS,
  NOTIFICATION_FEED_LIMIT,
  NOTIFICATION_LOOKBACK_DAYS,
} from "@/lib/notificationFeed";
import { resolvePrefs } from "@/lib/notifications";

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
 *
 * Honours the reader's own Settings → Notifications switches. Those switches
 * were written to User.notificationPrefs and read by nothing at all — no
 * sender, no feed — so turning one off changed nothing anybody could see. They
 * are keyed by the same action strings this feed selects on, so applying them
 * here is one narrowing of the `in` list. The Slack fan-out stays org-level and
 * is unaffected: a channel is shared, and one member muting their own bell must
 * not silence the team's channel.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const orgId = (session.user as any).orgId as string | undefined;
  if (!orgId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const userId = (session.user as any).id as string | undefined;
  const me = userId
    ? await db.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } })
    : null;
  const prefs = resolvePrefs(me?.notificationPrefs);
  const wantedActions = NOTIFIABLE_ACTIONS.filter((action) => prefs[action] !== false);

  /* Every switch off is a legitimate answer, not an error — and an empty `in`
     list would match nothing anyway, so skip the queries rather than pay for
     two that cannot return a row. */
  if (wantedActions.length === 0) {
    return Response.json({ items: [], unreadCount: 0 });
  }

  const sinceParam = new URL(req.url).searchParams.get("since");
  const sinceDate = sinceParam ? new Date(sinceParam) : null;
  const since = sinceDate && !Number.isNaN(sinceDate.getTime()) ? sinceDate : null;

  const floor = new Date(Date.now() - NOTIFICATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const where = {
    orgId,
    action: { in: wantedActions },
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
