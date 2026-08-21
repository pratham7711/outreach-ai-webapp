import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOrgEntitlements } from "@/lib/entitlements";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;

  const [campaignCount, creatorCount, recentCampaigns, entitlements] = await Promise.all([
    db.campaign.count({ where: { orgId, deletedAt: null } }),
    db.creator.count({ where: { orgId, deletedAt: null } }),
    db.campaign.findMany({
      where: { orgId, deletedAt: null },
      include: { client: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 5,
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
      dashboardWidgets={dashboardWidgets}
    />
  );
}
