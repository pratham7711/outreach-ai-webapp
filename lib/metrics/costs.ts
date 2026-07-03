import { roundMoney, toCount } from "./numbers";

export type EngagementCounts = {
  likes?: number | null;
  comments?: number | null;
  shares?: number | null;
  saves?: number | null;
};

export function sumEngagements(counts: EngagementCounts): number {
  return (
    toCount(counts.likes) +
    toCount(counts.comments) +
    toCount(counts.shares) +
    toCount(counts.saves)
  );
}

export function computeCpm(input: {
  spend?: number | null;
  views?: number | null;
}): number | null {
  const spend = toCount(input.spend);
  const views = toCount(input.views);
  if (views <= 0) return null;
  return roundMoney((spend / views) * 1000);
}

export function computeCpe(input: {
  spend?: number | null;
  engagements?: number | null;
}): number | null {
  const spend = toCount(input.spend);
  const engagements = toCount(input.engagements);
  if (engagements <= 0) return null;
  return roundMoney(spend / engagements);
}

export function computeEngagementRate(
  input: { views?: number | null } & EngagementCounts
): number | null {
  const views = toCount(input.views);
  if (views <= 0) return null;
  return sumEngagements(input) / views;
}
