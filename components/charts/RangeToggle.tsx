"use client";

import { Toggle } from "@/components/insights/parts";
import { CHART_RANGES, type ChartRange } from "@/lib/charts/seriesMode";

/** 7D / 30D / 90D / All, in the same control as the Daily / Cumulative switch. */
export function RangeToggle({
  value,
  onChange,
  label = "Chart range",
}: {
  value: ChartRange;
  onChange: (range: ChartRange) => void;
  label?: string;
}) {
  return (
    <Toggle<ChartRange>
      label={label}
      value={value}
      onChange={onChange}
      options={CHART_RANGES.map((r) => ({ value: r.value, label: r.label }))}
    />
  );
}
