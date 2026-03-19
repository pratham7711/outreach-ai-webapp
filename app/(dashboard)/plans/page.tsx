import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import PlansClient from "./PlansClient";

export default async function PlansPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
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
        features: p.features as Record<string, boolean>,
        isCustom: p.isCustom,
        clientCount: p._count.clients,
        createdAt: p.createdAt.toISOString(),
      }))}
    />
  );
}
