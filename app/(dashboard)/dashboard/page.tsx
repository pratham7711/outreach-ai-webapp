import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getOrgEntitlements } from "@/lib/entitlements";
import DashboardClient from "./DashboardClient";

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;

  const [campaignCount, creatorCount, pendingPayoutsAgg, recentCampaigns, entitlements] = await Promise.all([
    db.campaign.count({ where: { orgId, deletedAt: null } }),
    db.creator.count({ where: { orgId, deletedAt: null } }),
    db.payout.aggregate({ where: { orgId, status: "PENDING" }, _sum: { amount: true } }),
    db.campaign.findMany({
      where: { orgId, deletedAt: null },
      include: { client: { select: { name: true } } },
      orderBy: { updatedAt: "desc" },
      take: 5,
    }),
    getOrgEntitlements(orgId),
  ]);

  const pendingPayouts = pendingPayoutsAgg._sum.amount ?? 0;
  const dashboardWidgets = Array.isArray((entitlements?.uiConfig as { dashboard?: unknown } | null)?.dashboard)
    ? ((entitlements?.uiConfig as { dashboard?: string[] } | null)?.dashboard ?? null)
    : null;

  // Chart data: aggregate monthly spend from payouts in the last 6 months
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

  const recentPayouts = await db.payout.findMany({
    where: { orgId, createdAt: { gte: sixMonthsAgo } },
    select: { amount: true, createdAt: true },
  });

  const monthMap = new Map<string, number>();
  for (const p of recentPayouts) {
    const key = p.createdAt.toLocaleString("en-US", { month: "short" });
    monthMap.set(key, (monthMap.get(key) ?? 0) + Number(p.amount));
  }
  const chartData = Array.from(monthMap.entries()).map(([month, spend]) => ({ month, spend }));

  return (
    <DashboardClient
      campaignCount={campaignCount}
      creatorCount={creatorCount}
      pendingPayouts={Number(pendingPayouts)}
      recentCampaigns={recentCampaigns.map(c => ({
        id: c.id,
        title: c.title,
        status: c.status,
        budget: c.budget ? Number(c.budget) : null,
        client: c.client,
      }))}
      chartData={chartData}
      dashboardWidgets={dashboardWidgets}
    />
  );
}
