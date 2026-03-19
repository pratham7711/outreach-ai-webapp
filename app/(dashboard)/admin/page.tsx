import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import FeatureAccessClient from "./FeatureAccessClient";

export default async function AdminPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId as string;

  const [clients, plans] = await Promise.all([
    db.client.findMany({
      where: { orgId },
      include: { plan: true, _count: { select: { campaigns: true } } },
      orderBy: { name: "asc" },
    }),
    db.plan.findMany({
      where: { orgId },
      include: { _count: { select: { clients: true } } },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <FeatureAccessClient
      clients={clients.map((c) => ({
        id: c.id,
        name: c.name,
        logoUrl: c.logoUrl,
        planId: c.planId,
        planName: c.plan?.name ?? null,
        planFeatures: c.plan ? (JSON.parse(c.plan.features as string) as Record<string, boolean>) : null,
        featureOverrides: c.featureOverrides ? (JSON.parse(c.featureOverrides as string) as Record<string, boolean>) : null,
        campaignCount: c._count.campaigns,
      }))}
      plans={plans.map((p) => ({
        id: p.id,
        name: p.name,
        features: JSON.parse(p.features as string) as Record<string, boolean>,
        clientCount: p._count.clients,
      }))}
    />
  );
}
