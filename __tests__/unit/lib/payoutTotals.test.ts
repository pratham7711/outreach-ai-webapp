/**
 * Payout totals, per currency.
 *
 * The /payouts tiles used to read five `_sum.amount` aggregates taken over the
 * whole table and print each with a hardcoded "$", so an org paying creators in
 * pounds and rupees saw the two added together and labelled as dollars. This is
 * the aggregation that replaces them.
 */
import { summarizePayoutTotals, type PayoutGroupRow } from "@/lib/payouts/totals";

const row = (currency: string, status: string, amount: number | null): PayoutGroupRow => ({
  currency,
  status,
  _sum: { amount },
});

describe("summarizePayoutTotals", () => {
  it("keeps each currency's money in its own bucket", () => {
    const totals = summarizePayoutTotals([
      row("USD", "SUCCESS", 1000),
      row("GBP", "SUCCESS", 40),
      row("USD", "PENDING", 250),
      row("GBP", "FAILED", 10),
    ]);

    expect(totals).toEqual([
      { currency: "USD", total: 1250, sent: 1000, pending: 250, processing: 0, failed: 0 },
      { currency: "GBP", total: 50, sent: 40, pending: 0, processing: 0, failed: 10 },
    ]);
  });

  it("never adds two currencies into one figure", () => {
    const totals = summarizePayoutTotals([
      row("INR", "SUCCESS", 90000),
      row("EUR", "SUCCESS", 900),
    ]);
    expect(totals.map((t) => t.sent)).toEqual([90000, 900]);
    expect(totals.some((t) => t.sent === 90900)).toBe(false);
  });

  it("maps every status the page has a tile for", () => {
    const [totals] = summarizePayoutTotals([
      row("USD", "SUCCESS", 1),
      row("USD", "PENDING", 2),
      row("USD", "PROCESSING", 4),
      row("USD", "FAILED", 8),
    ]);
    expect(totals).toEqual({
      currency: "USD", total: 15, sent: 1, pending: 2, processing: 4, failed: 8,
    });
  });

  /* Prisma's _sum comes back null for a group with no rows to add. */
  it("treats a null sum as zero rather than NaN", () => {
    const [totals] = summarizePayoutTotals([row("USD", "SUCCESS", null)]);
    expect(totals.sent).toBe(0);
    expect(totals.total).toBe(0);
  });

  /* A status no tile knows about must still reach `total`, or the money vanishes. */
  it("counts an unmodelled status towards the currency total only", () => {
    const [totals] = summarizePayoutTotals([
      row("USD", "SUCCESS", 100),
      row("USD", "REVERSED", 25),
    ]);
    expect(totals.total).toBe(125);
    expect(totals.sent).toBe(100);
    expect(totals.pending + totals.processing + totals.failed).toBe(0);
  });

  it("orders by total descending, with the currency code as a stable tiebreak", () => {
    const totals = summarizePayoutTotals([
      row("GBP", "SUCCESS", 500),
      row("USD", "SUCCESS", 500),
      row("INR", "SUCCESS", 9000),
    ]);
    expect(totals.map((t) => t.currency)).toEqual(["INR", "GBP", "USD"]);
  });

  it("returns nothing for an org with no payouts", () => {
    expect(summarizePayoutTotals([])).toEqual([]);
  });
});
