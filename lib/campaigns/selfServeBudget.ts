export type SelfServeBudgetInput = {
  creatorRates: number[];
  platformFeeMinor: number;
  currency: string;
};

export type SelfServeBudgetLineItem = {
  index: number;
  rate: number;
};

export type SelfServeBudget = {
  currency: string;
  creatorTotal: number;
  platformFee: number;
  total: number;
  perCreator: SelfServeBudgetLineItem[];
};

function toFiniteNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function computeSelfServeBudget(input: SelfServeBudgetInput): SelfServeBudget {
  const rates = Array.isArray(input?.creatorRates) ? input.creatorRates : [];
  const currency = typeof input?.currency === "string" && input.currency ? input.currency : "USD";

  const perCreator: SelfServeBudgetLineItem[] = rates.map((rate, index) => ({
    index,
    rate: Math.max(0, toFiniteNumber(rate)),
  }));

  const creatorTotal = perCreator.reduce((sum, item) => sum + item.rate, 0);
  const platformFeeMinor = Math.max(0, Math.round(toFiniteNumber(input?.platformFeeMinor)));
  const platformFee = platformFeeMinor / 100;
  const total = creatorTotal + platformFee;

  return {
    currency,
    creatorTotal,
    platformFee,
    total,
    perCreator,
  };
}
