import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import CampaignsClient from "./CampaignsClient";

export default async function CampaignsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;

  const [campaigns, total, activeCount, creatorCount, budgetAgg] = await Promise.all([
    db.campaign.findMany({
      where: { orgId, deletedAt: null },
      include: {
        client: { select: { name: true } },
        _count: { select: { activations: true, posts: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    db.campaign.count({ where: { orgId, deletedAt: null } }),
    db.campaign.count({ where: { orgId, deletedAt: null, status: "IN_PROGRESS" } }),
    db.creator.count({ where: { orgId, deletedAt: null } }),
    db.campaign.aggregate({ where: { orgId, deletedAt: null }, _sum: { budget: true } }),
  ]);

  return (
    <CampaignsClient
      campaigns={campaigns.map(c => ({
        id: c.id,
        title: c.title,
        status: c.status,
        budget: c.budget ? Number(c.budget) : null,
        currency: c.currency,
        client: c.client,
        _count: c._count,
      }))}
      stats={{
        total,
        active: activeCount,
        creatorCount,
        totalBudget: Number(budgetAgg._sum.budget ?? 0),
      }}
    />
  );
}
