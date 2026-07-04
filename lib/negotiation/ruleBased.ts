import type { NegotiationAdvisor, ProposeCounterInput, ProposeCounterResult } from "./types";

function computeCounterRate(offeredRate: number, creatorCounterRate: number): number {
  const midpoint = (offeredRate + creatorCounterRate) / 2;
  const ceiling = offeredRate * 1.25;
  const bounded = Math.min(midpoint, ceiling, creatorCounterRate);
  const floored = Math.max(bounded, offeredRate);
  return Math.round(floored);
}

function formatRate(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${currency} ${Math.round(value)}`;
  }
}

export class RuleBasedAdvisor implements NegotiationAdvisor {
  async proposeCounter(input: ProposeCounterInput): Promise<ProposeCounterResult> {
    const counterRate = computeCounterRate(input.offeredRate, input.creatorCounterRate);
    const offered = formatRate(input.offeredRate, input.currency);
    const asked = formatRate(input.creatorCounterRate, input.currency);
    const proposed = formatRate(counterRate, input.currency);

    const message =
      `Thanks for the counter of ${asked} — we appreciate you sharing your rate. ` +
      `We started at ${offered}, and to keep this moving we can propose ${proposed}. ` +
      `This is subject to brand approval, but we'd love to lock it in if that works for you.`;

    return { counterRate, message };
  }
}
