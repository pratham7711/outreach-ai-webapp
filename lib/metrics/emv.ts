import { roundMoney, toCount } from "./numbers";

export type EmvPlatform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE";

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
