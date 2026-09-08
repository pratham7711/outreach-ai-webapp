import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { summarizePayoutTotals } from "@/lib/payouts/totals";
import PayoutsClient from "./PayoutsClient";

export default async function PayoutsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const orgId = (session.user as any).orgId;

  /* The creator and campaign pickers used to be selected here and passed
     down. They belong to a dialog that is usually never opened, and they were
     1,837 rows and 521 rows of it in every page load, so they now load from
     /api/payouts/options when the dialog does. */
  /* One groupBy instead of five whole-table aggregates, and grouped by currency
     as well as status. A payout carries its own currency -- POST /api/payouts
     takes USD, EUR, GBP and INR -- so the old `_sum.amount` over every row added
     pounds to rupees and the tiles printed the result with a dollar sign. */
  const [payouts, totalsRows] = await Promise.all([
    db.payout.findMany({
      where: { orgId },
      include: {
        creator: { select: { id: true, name: true, handle: true, platform: true } },
        campaign: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    db.payout.groupBy({
      by: ["currency", "status"],
      where: { orgId },
      _sum: { amount: true },
    }),
  ]);

  return (
    <PayoutsClient
      payouts={payouts.map(p => ({
        id: p.id,
        amount: Number(p.amount),
        currency: p.currency,
        status: p.status,
        paymentMethod: p.paymentMethod,
        recipientPaypalEmail: p.recipientPaypalEmail,
        transactionId: p.transactionId,
        failureReason: p.failureReason,
        createdAt: p.createdAt.toISOString(),
        initiatedAt: p.initiatedAt.toISOString(),
        completedAt: p.completedAt?.toISOString() ?? null,
        creator: p.creator,
        campaign: p.campaign,
      }))}
      stats={summarizePayoutTotals(totalsRows)}
    />
  );
}
