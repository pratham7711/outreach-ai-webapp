import { formatFull } from "@/lib/format";
import { isUnknownMetric, metricText, type MetricValue } from "@/lib/creators/metricValue";

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
}: {
  value: MetricValue;
  format?: (n: number) => string;
}) {
  if (!isUnknownMetric(value)) return <>{format(value)}</>;
  return (
    <span title={value.reason} data-unknown="" style={{ cursor: "help" }}>
      <span aria-hidden="true">{metricText(value)}</span>
      <span className="sr-only">Unknown. {value.reason}</span>
    </span>
  );
}
