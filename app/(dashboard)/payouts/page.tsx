import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import PayoutsClient from "./PayoutsClient";

export default async function PayoutsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;

  const [payouts, totalAgg, sentAgg, pendingAgg] = await Promise.all([
    db.payout.findMany({
      where: { orgId },
      include: {
        creator: { select: { id: true, name: true, handle: true, platform: true } },
        campaign: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.payout.aggregate({ where: { orgId }, _sum: { amount: true } }),
    db.payout.aggregate({ where: { orgId, status: "SUCCESS" }, _sum: { amount: true } }),
    db.payout.aggregate({ where: { orgId, status: "PENDING" }, _sum: { amount: true } }),
  ]);

  return (
    <PayoutsClient
      payouts={payouts.map(p => ({
        id: p.id,
        amount: Number(p.amount),
        status: p.status,
        createdAt: p.createdAt.toISOString(),
        creator: p.creator,
        campaign: p.campaign,
      }))}
      stats={{
        total: Number(totalAgg._sum.amount ?? 0),
        sent: Number(sentAgg._sum.amount ?? 0),
        pending: Number(pendingAgg._sum.amount ?? 0),
      }}
    />
  );
}
