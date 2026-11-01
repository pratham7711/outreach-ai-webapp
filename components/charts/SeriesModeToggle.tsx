"use client";

import { Toggle } from "@/components/insights/parts";
import type { SeriesMode } from "@/lib/charts/seriesMode";

/**
 * The Daily / Cumulative switch every time-series chart carries. `periodLabel`
 * names the first option after the chart's bucket ("Weekly", "Monthly",
 * "Per 6h") so the word never claims days when the bars are weeks.
 */
export function SeriesModeToggle({
  value,
  onChange,
  periodLabel = "Daily",
  label = "Chart values",
}: {
  value: SeriesMode;
  onChange: (mode: SeriesMode) => void;
  periodLabel?: string;
  label?: string;
}) {
  return (
    <Toggle<SeriesMode>
      label={label}
      value={value}
      onChange={onChange}
      options={[
        { value: "daily", label: periodLabel },
        { value: "cumulative", label: "Cumulative" },
      ]}
    />
  );
}
