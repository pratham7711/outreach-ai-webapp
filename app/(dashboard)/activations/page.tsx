import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import ActivationsClient from "./ActivationsClient";

export default async function ActivationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [activations, total, activeCount] = await Promise.all([
    db.activation.findMany({
      where: { deletedAt: null },
      include: {
        creator: { select: { id: true, name: true, handle: true, platform: true, avatarUrl: true } },
        campaign: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.activation.count({ where: { deletedAt: null } }),
    db.activation.count({ where: { deletedAt: null, status: { in: ["POSTING", "POSTED"] } } }),
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
    />
  );
}
