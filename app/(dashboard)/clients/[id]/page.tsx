import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import ClientDetailClient from "./ClientDetailClient";

export default async function ClientDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId as string;
  const { id } = await params;

  const [client, plans] = await Promise.all([
    db.client.findFirst({
      where: { id, orgId },
      include: {
        plan: true,
        _count: { select: { campaigns: true } },
      },
    }),
    db.plan.findMany({
      where: { orgId },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!client) notFound();

  return (
    <ClientDetailClient
      client={{
        id: client.id,
        name: client.name,
        logoUrl: client.logoUrl,
        contactInfo: client.contactInfo,
        planId: client.planId,
        featureOverrides: (client.featureOverrides ?? null) as Record<string, boolean> | null,
        campaignCount: client._count.campaigns,
        plan: client.plan
          ? {
              id: client.plan.id,
              name: client.plan.name,
              features: client.plan.features as Record<string, boolean>,
            }
          : null,
      }}
      plans={plans.map((p) => ({
        id: p.id,
        name: p.name,
        features: p.features as Record<string, boolean>,
      }))}
    />
  );
}
