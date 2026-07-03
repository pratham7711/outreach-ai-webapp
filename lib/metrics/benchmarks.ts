import { toFiniteOrNull } from "./numbers";

export type BaselineComparison = {
  delta: number | null;
  pct: number | null;
};

export function compareToBaseline(input: {
  value?: number | null;
  baseline?: number | null;
}): BaselineComparison {
  const value = toFiniteOrNull(input.value);
  const baseline = toFiniteOrNull(input.baseline);
  if (value === null || baseline === null) return { delta: null, pct: null };
  const delta = value - baseline;
  const pct = baseline === 0 ? null : (delta / baseline) * 100;
  return { delta, pct };
}

export type OrgAverageComparison = {
  orgAvg: number | null;
  delta: number | null;
  pct: number | null;
};

export function campaignVsOrgAverage(input: {
  campaignValue?: number | null;
  orgValues: readonly (number | null | undefined)[];
}): OrgAverageComparison {
  const values = input.orgValues.filter(
    (value): value is number => typeof value === "number" && Number.isFinite(value)
  );
  if (values.length === 0) return { orgAvg: null, delta: null, pct: null };
  const orgAvg = values.reduce((total, value) => total + value, 0) / values.length;
  const campaignValue = toFiniteOrNull(input.campaignValue);
  if (campaignValue === null) return { orgAvg, delta: null, pct: null };
  const delta = campaignValue - orgAvg;
  const pct = orgAvg === 0 ? null : (delta / orgAvg) * 100;
  return { orgAvg, delta, pct };
}
