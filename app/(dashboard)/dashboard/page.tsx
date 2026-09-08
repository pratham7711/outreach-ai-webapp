import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOrgEntitlements } from "@/lib/entitlements";
import DashboardClient from "./DashboardClient";
import { NOTIFIABLE_ACTIONS, NOTIFICATION_LOOKBACK_DAYS } from "@/lib/notificationFeed";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;

  const activityFloor = new Date(Date.now() - NOTIFICATION_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [campaignCount, creatorCount, recentCampaigns, recentEvents, entitlements] = await Promise.all([
    db.campaign.count({ where: { orgId, deletedAt: null } }),
    db.creator.count({ where: { orgId, deletedAt: null } }),
    db.campaign.findMany({
      where: { orgId, deletedAt: null },
      include: { client: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    /* The activity feed's own source. Same AuditLog stream the top bar's bell
       reads, narrowed to the notification catalog so settings churn and key
       rotations do not fill it. Indexed on [orgId, createdAt]. */
    db.auditLog.findMany({
      where: { orgId, action: { in: NOTIFIABLE_ACTIONS }, createdAt: { gte: activityFloor } },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: {
        id: true,
        action: true,
        entityType: true,
        entityId: true,
        entityLabel: true,
        actorEmail: true,
        createdAt: true,
      },
    }),
    getOrgEntitlements(orgId),
  ]);

  const dashboardWidgets = Array.isArray((entitlements?.uiConfig as { dashboard?: unknown } | null)?.dashboard)
    ? ((entitlements?.uiConfig as { dashboard?: string[] } | null)?.dashboard ?? null)
    : null;

  return (
    <DashboardClient
      campaignCount={campaignCount}
      creatorCount={creatorCount}
      recentCampaigns={recentCampaigns.map(c => ({
        id: c.id,
        title: c.title,
        status: c.status,
        client: c.client,
        updatedAt: c.updatedAt?.toISOString() ?? null,
      }))}
      recentEvents={recentEvents.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() }))}
      dashboardWidgets={dashboardWidgets}
    />
  );
}
