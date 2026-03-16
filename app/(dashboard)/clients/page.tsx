import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import ClientsClient from "./ClientsClient";

export default async function ClientsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;

  const [clients, campaignCount] = await Promise.all([
    db.client.findMany({
      where: { orgId },
      include: { _count: { select: { campaigns: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.campaign.count({ where: { orgId, deletedAt: null } }),
  ]);

  return (
    <ClientsClient
      clients={clients.map(c => ({
        id: c.id,
        name: c.name,
        logoUrl: c.logoUrl,
        contactInfo: c.contactInfo,
        _count: c._count,
      }))}
      stats={{ total: clients.length, totalCampaigns: campaignCount }}
    />
  );
}
