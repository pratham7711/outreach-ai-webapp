/**
 * Payout money, added up per currency.
 *
 * A payout carries its own currency — POST /api/payouts accepts USD, EUR, GBP
 * and INR, and the CSV export writes `p.currency` on every row — so a single
 * `_sum.amount` over the whole table adds pounds to rupees and prints the
 * result with a dollar sign. The four tiles on /payouts did exactly that.
 *
 * /api/financial-reports already buckets its money by currency for the same
 * reason; this is that shape, made reusable and given the two extra statuses
 * the payouts page shows.
 */

export type PayoutStatusKey = "SUCCESS" | "PENDING" | "PROCESSING" | "FAILED";

/** One row of `db.payout.groupBy({ by: ["currency", "status"], _sum: { amount: true } })`. */
export type PayoutGroupRow = {
  currency: string;
  status: string;
  _sum: { amount: number | null };
};

export type PayoutCurrencyTotals = {
  currency: string;
  /** Every payout in this currency, whatever its status. */
  total: number;
  sent: number;
  pending: number;
  processing: number;
  failed: number;
};

const STATUS_FIELD: Record<PayoutStatusKey, "sent" | "pending" | "processing" | "failed"> = {
  SUCCESS: "sent",
  PENDING: "pending",
  PROCESSING: "processing",
  FAILED: "failed",
};

/**
 * Groups the rows into one bucket per currency.
 *
 * Ordered by total descending so the currency the org actually works in leads,
 * with the code as a tiebreak — the order has to be stable, or two tiles built
 * from the same data can disagree about which line comes first.
 *
 * A status nobody models (a future PayoutStatus, say) still counts towards
 * `total`: the tile that would drop it does not exist, so silently discarding
 * the money would be the worse answer.
 */
export function summarizePayoutTotals(
  rows: readonly PayoutGroupRow[]
): PayoutCurrencyTotals[] {
  const byCurrency = new Map<string, PayoutCurrencyTotals>();

  for (const row of rows) {
    const amount = row._sum.amount ?? 0;
    const currency = row.currency;
    let bucket = byCurrency.get(currency);
    if (!bucket) {
      bucket = { currency, total: 0, sent: 0, pending: 0, processing: 0, failed: 0 };
      byCurrency.set(currency, bucket);
    }
    bucket.total += amount;
    const field = STATUS_FIELD[row.status as PayoutStatusKey];
    if (field) bucket[field] += amount;
  }

  return Array.from(byCurrency.values()).sort(
    (a, b) => b.total - a.total || a.currency.localeCompare(b.currency)
  );
}
