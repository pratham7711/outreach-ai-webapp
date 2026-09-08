import { roundMoney, toCount } from "./numbers";

export type EmvPlatform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE";

/**
 * The rate card is quoted in US dollars and nothing here converts it.
 *
 * EMV_RATES is the Ayzenberg table (see docs/METRICS_FORMULAS.md), published in
 * USD per interaction. A campaign carries its own currency, and every surface
 * that printed EMV formatted it with that currency -- so an INR campaign's
 * $23,211 of earned media rendered with a rupee sign in front of it, a figure
 * roughly 83x smaller in real money than the one shown. There is no FX rate
 * anywhere in the product, so inventing one here would be worse than saying
 * plainly which unit this is.
 */
export const EMV_CURRENCY = "USD";

/**
 * "EMV" for a USD campaign, "EMV (USD)" for any other.
 *
 * A USD campaign needs no disambiguation and the plain label is what the
 * reference report prints; anywhere else the unit has to travel with the number
 * or the reader will assume it matches the budget beside it.
 */
export function emvLabel(campaignCurrency: string | null | undefined, base = "EMV"): string {
  return (campaignCurrency ?? EMV_CURRENCY).toUpperCase() === EMV_CURRENCY
    ? base
    : `${base} (${EMV_CURRENCY})`;
}

export type EmvRateCard = {
  view: number;
  like: number;
  comment: number;
  share: number;
  save: number;
};

export const EMV_RATES: Record<EmvPlatform, EmvRateCard> = {
  TIKTOK: { view: 0.04, like: 0.5, comment: 1.5, share: 1.25, save: 1.25 },
  INSTAGRAM: { view: 0.12, like: 0.32, comment: 3.82, share: 2.83, save: 1.25 },
  YOUTUBE: { view: 0.12, like: 0.56, comment: 3.34, share: 2.69, save: 1.25 },
};

const ZERO_RATES: EmvRateCard = {
  view: 0,
  like: 0,
  comment: 0,
  share: 0,
  save: 0,
};

export type PostEmvInput = {
  platform: string;
  views?: number | null;
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
};

export function getEmvRates(platform: string): EmvRateCard {
  return platform in EMV_RATES ? EMV_RATES[platform as EmvPlatform] : ZERO_RATES;
}

function computePostEmvRaw(input: PostEmvInput): number {
  const rates = getEmvRates(input.platform);
  return (
    toCount(input.views) * rates.view +
    toCount(input.likes) * rates.like +
    toCount(input.comments) * rates.comment +
    toCount(input.shares) * rates.share +
    toCount(input.saves) * rates.save
  );
}

export function computePostEmv(input: PostEmvInput): number {
  return roundMoney(computePostEmvRaw(input));
}

export function computeCampaignEmv(posts: readonly PostEmvInput[]): number {
  return roundMoney(posts.reduce((total, post) => total + computePostEmvRaw(post), 0));
}
