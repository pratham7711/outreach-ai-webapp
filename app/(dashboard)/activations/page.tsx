import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import ActivationsClient from "./ActivationsClient";

export default async function ActivationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const orgId = (session.user as any).orgId;
  // The create form searches for a campaign and a creator through their listing
  // APIs, so neither table is serialized into this page.
  const [activations, total, activeCount, statusDefs] = await Promise.all([
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
    // The org's named activation statuses from Settings → General. Empty for an
    // org that has defined none, in which case the rows show the enum label as
    // they always did.
    db.activationStatusDef.findMany({
      where: { orgId },
      select: { id: true, name: true, bucket: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
  ]);

  return (
    <ActivationsClient
      activations={activations.map(a => ({
        id: a.id,
        status: a.status,
        statusDefId: a.statusDefId,
        statusDefName: statusDefs.find((d) => d.id === a.statusDefId)?.name ?? null,
        createdAt: a.createdAt.toISOString(),
        // The reference labels this column "Last Status Change". updatedAt is
        // bumped by any edit, notes and posted URL included, so the column is
        // labelled "Last Update" here rather than claiming more than it knows. A
        // true status-change time is derivable from the activation.update audit
        // rows the campaign activity feed already writes, if it is ever wanted.
        updatedAt: a.updatedAt.toISOString(),
        creator: a.creator,
        campaign: a.campaign,
      }))}
      stats={{ total, active: activeCount }}
      statusDefs={statusDefs}
    />
  );
}
