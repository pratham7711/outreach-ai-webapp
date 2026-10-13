import { formatFull } from "@/lib/format";
import { isUnknownMetric, metricText, type MetricValue } from "@/lib/creators/metricValue";
import { breakableFigure } from "@/components/ds/BreakableFigure";

/**
 * A creator figure as it is shown on a screen: the number, or "—" carrying why.
 *
 * The reason is in the tooltip for a pointer and in visually hidden text for a
 * screen reader -- the dash itself is hidden from assistive tech, because "em
 * dash" read aloud says nothing. See lib/creators/metricValue for what decides
 * "unknown".
 */
export default function MetricFigure({
  value,
  format = formatFull,
  breakable = false,
}: {
  value: MetricValue;
  format?: (n: number) => string;
  /** May wrap between digit groups -- for a narrow card, not a table column. */
  breakable?: boolean;
}) {
  /* A card wraps the figure rather than cutting it (see BreakableFigure); the
     text is the same string either way. A table keeps it on one line, where a
     column that wraps a number mid-figure is worse than one that scrolls. */
  if (!isUnknownMetric(value)) return <>{breakable ? breakableFigure(format(value)) : format(value)}</>;
  return (
    <span title={value.reason} data-unknown="" style={{ cursor: "help" }}>
      <span aria-hidden="true">{metricText(value)}</span>
      <span className="sr-only">Unknown. {value.reason}</span>
    </span>
  );
}
