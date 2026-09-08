/**
 * Money that carries its own currency, added up without pretending it doesn't.
 *
 * Payouts, payout requests, negotiation offers and marketplace earnings each
 * store a per-row currency, and several screens summed the column with a
 * `reduce` and printed the result behind one symbol -- so a rupee offer and a
 * euro offer became "$40,500", a figure that is not true in any currency. There
 * is no FX rate anywhere in this product, so the only honest headline for mixed
 * money is one figure per currency.
 *
 * lib/payouts/totals.ts already buckets the payouts page this way; this is the
 * same shape, generalised, so the other surfaces do not each grow their own.
 */

export type CurrencyAmount = {
  currency: string;
  amount: number;
};

/**
 * One bucket per currency, largest first with the code as a stable tiebreak.
 *
 * The order has to be deterministic or two tiles built from the same rows can
 * disagree about which line leads. Rows with a falsy currency fall back to
 * `fallback` rather than opening a bucket named "": an unlabelled row is
 * overwhelmingly a default that was never written, not a new currency.
 */
export function totalsByCurrency(
  rows: readonly { currency?: string | null; amount: number }[],
  fallback = "USD"
): CurrencyAmount[] {
  const byCurrency = new Map<string, number>();
  for (const row of rows) {
    const currency = (row.currency || fallback).toUpperCase();
    byCurrency.set(currency, (byCurrency.get(currency) ?? 0) + (row.amount || 0));
  }
  return Array.from(byCurrency, ([currency, amount]) => ({ currency, amount })).sort(
    (a, b) => b.amount - a.amount || a.currency.localeCompare(b.currency)
  );
}

/** One amount, in its own currency. Intl knows every currency's symbol. */
export function formatMoney(
  amount: number,
  currency = "USD",
  options: Intl.NumberFormatOptions = {}
): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    ...options,
  }).format(Number.isFinite(amount) ? amount : 0);
}

/**
 * A headline for money that may be in more than one currency.
 *
 * One currency renders as one figure; several render as "₹40,000 · €500",
 * because the alternative is a sum that is wrong in every currency it names.
 * An empty set renders as zero in `fallback` -- a tile has to say something,
 * and "no money" is a true statement about an empty list.
 */
export function formatCurrencyTotals(
  totals: readonly CurrencyAmount[],
  fallback = "USD",
  options: Intl.NumberFormatOptions = {}
): string {
  if (totals.length === 0) return formatMoney(0, fallback, options);
  return totals.map((t) => formatMoney(t.amount, t.currency, options)).join(" · ");
}

/** `totalsByCurrency` + `formatCurrencyTotals` in one call, for a tile. */
export function formatRowsByCurrency(
  rows: readonly { currency?: string | null; amount: number }[],
  fallback = "USD",
  options: Intl.NumberFormatOptions = {}
): string {
  return formatCurrencyTotals(totalsByCurrency(rows, fallback), fallback, options);
}
