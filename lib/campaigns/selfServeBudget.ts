export type SelfServeBudgetInput = {
  /**
   * One entry per selected creator. `null` means the creator has no rate on
   * file — which is NOT a rate of zero, and the difference is the whole point of
   * this type: this runs a checkout. Creator.rate is nullable and set on 12 of
   * 1,834 creators, so pricing the other 1,822 at 0 would show a total that
   * cannot be what anyone pays.
   */
  creatorRates: (number | null)[];
  platformFeeMinor: number;
  currency: string;
};

export type SelfServeBudgetLineItem = {
  index: number;
  /** null when this creator has no rate on file. */
  rate: number | null;
};

export type SelfServeBudget = {
  currency: string;
  creatorTotal: number;
  platformFee: number;
  total: number;
  perCreator: SelfServeBudgetLineItem[];
  /**
   * How many selected creators carry no rate. The total covers the priced ones
   * only, so any caller showing that total has to show this count too or it is
   * quoting a number it knows is short.
   */
  unpricedCreators: number;
};

function toFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** A usable price, or null for anything that is not one. */
function toRate(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value > 0 ? value : null;
}

export function computeSelfServeBudget(input: SelfServeBudgetInput): SelfServeBudget {
  const rates = Array.isArray(input?.creatorRates) ? input.creatorRates : [];
  const currency = typeof input?.currency === "string" && input.currency ? input.currency : "USD";

  const perCreator: SelfServeBudgetLineItem[] = rates.map((rate, index) => ({
    index,
    rate: toRate(rate),
  }));

  const creatorTotal = perCreator.reduce((sum, item) => sum + (item.rate ?? 0), 0);
  const unpricedCreators = perCreator.filter((item) => item.rate === null).length;
  const platformFeeMinor = Math.max(0, Math.round(toFiniteNumber(input?.platformFeeMinor)));
  const platformFee = platformFeeMinor / 100;
  const total = creatorTotal + platformFee;

  return {
    currency,
    creatorTotal,
    platformFee,
    total,
    perCreator,
    unpricedCreators,
  };
}
