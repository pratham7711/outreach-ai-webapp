import { db } from "@/lib/db";
import { buildRecipients, summarizeRecipients, type Recipient, type RecipientPayout, type RecipientStats } from "./aggregate";

export type RecipientsResult = {
  recipients: Recipient[];
  stats: RecipientStats;
};

export async function getRecipients(orgId: string): Promise<RecipientsResult> {
  const payouts = await db.payout.findMany({
    where: { orgId },
    select: {
      creatorId: true,
      amount: true,
      status: true,
      paymentMethod: true,
      recipientPaypalEmail: true,
      completedAt: true,
      createdAt: true,
      creator: { select: { name: true, handle: true, platform: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const rows: RecipientPayout[] = payouts.map((p) => ({
    creatorId: p.creatorId,
    creatorName: p.creator?.name ?? "Unknown recipient",
    creatorHandle: p.creator?.handle ?? null,
    creatorPlatform: p.creator?.platform ?? null,
    amount: Number(p.amount),
    status: String(p.status),
    paymentMethod: String(p.paymentMethod),
    recipientPaypalEmail: p.recipientPaypalEmail ?? null,
    completedAt: p.completedAt ? new Date(p.completedAt).toISOString() : null,
    createdAt: new Date(p.createdAt).toISOString(),
  }));

  const recipients = buildRecipients(rows);
  const stats = summarizeRecipients(recipients);
  return { recipients, stats };
}
