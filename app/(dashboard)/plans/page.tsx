import { notFound, redirect } from "next/navigation";
import { hasPermission } from "@/lib/rbac";
import { ORG_ADMIN_PERMISSION } from "@/lib/dashboardPolicy";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import PlansClient from "./PlansClient";
import { asFeatureMap } from "@/lib/features";

export default async function PlansPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!hasPermission((session.user as { role?: string }).role ?? "", ORG_ADMIN_PERMISSION)) notFound();
  const orgId = (session.user as any).orgId as string;

  const plans = await db.plan.findMany({
    where: { orgId },
    include: { _count: { select: { clients: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <PlansClient
      plans={plans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        features: asFeatureMap(p.features) ?? {},
        isCustom: p.isCustom,
        clientCount: p._count.clients,
        createdAt: p.createdAt.toISOString(),
      }))}
    />
  );
}
