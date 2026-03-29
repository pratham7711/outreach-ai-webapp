import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import ActivationsClient from "./ActivationsClient";

export default async function ActivationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).orgId;
  const [activations, total, activeCount, creators, campaigns] = await Promise.all([
    db.activation.findMany({
      where: { deletedAt: null, campaign: { orgId } },
      include: {
        creator: { select: { id: true, name: true, handle: true, platform: true, avatarUrl: true } },
        campaign: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.activation.count({ where: { deletedAt: null, campaign: { orgId } } }),
    db.activation.count({ where: { deletedAt: null, campaign: { orgId }, status: { in: ["POSTING", "POSTED"] } } }),
    db.creator.findMany({ where: { orgId, deletedAt: null }, select: { id: true, name: true, handle: true }, orderBy: { name: "asc" } }),
    db.campaign.findMany({ where: { orgId, deletedAt: null }, select: { id: true, title: true }, orderBy: { title: "asc" } }),
  ]);

  return (
    <ActivationsClient
      activations={activations.map(a => ({
        id: a.id,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
        creator: a.creator,
        campaign: a.campaign,
      }))}
      stats={{ total, active: activeCount }}
      creators={creators}
      campaigns={campaigns}
    />
  );
}
