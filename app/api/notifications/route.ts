import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import {
  NOTIFIABLE_ACTIONS,
  NOTIFICATION_FEED_LIMIT,
  NOTIFICATION_LOOKBACK_DAYS,
  NOTIFICATION_PAGE_MAX,
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
 *
 * Paged, because the bell used to show the newest 8 of what could be 808 unread
 * with no way to reach the rest. `limit` (capped at NOTIFICATION_PAGE_MAX) sizes
 * a page, `before` is the createdAt of the oldest row already shown, and
 * `hasMore` says whether another page exists. A `before` page skips the unread
 * count: the first page already carries it, and it does not depend on paging.
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

  const params = new URL(req.url).searchParams;
  const parseDate = (raw: string | null) => {
    const d = raw ? new Date(raw) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  };
  const since = parseDate(params.get("since"));
  const before = parseDate(params.get("before"));
  const askedLimit = Number.parseInt(params.get("limit") ?? "", 10);
  const limit = Number.isFinite(askedLimit)
    ? Math.min(NOTIFICATION_PAGE_MAX, Math.max(1, askedLimit))
    : NOTIFICATION_FEED_LIMIT;

  const floor = new Date(Date.now() - NOTIFICATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const where = {
    orgId,
    action: { in: wantedActions },
    createdAt: { gte: floor },
  };

  const [rows, unreadCount] = await Promise.all([
    db.auditLog.findMany({
      /* `lte`, not `lt`: two rows written in the same millisecond can sit
         either side of a page boundary, and `lt` would skip the second. The
         repeated boundary row is dropped by id on the client. */
      where: before ? { ...where, createdAt: { gte: floor, lte: before } } : where,
      // id breaks ties, so the same rows come back in the same order each time.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      // One past the page, to answer hasMore without a second count.
      take: limit + 1,
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
    before
      ? Promise.resolve(undefined)
      : db.auditLog.count({
          where: since ? { ...where, createdAt: { gte: since > floor ? since : floor } } : where,
        }),
  ]);
  const logs = rows.slice(0, limit);

  return Response.json({
    items: logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })),
    unreadCount,
    hasMore: rows.length > limit,
  });
}
