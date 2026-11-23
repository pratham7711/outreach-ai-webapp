import type { AudienceSummary } from "@/lib/creators/audienceSummary";
import { formatPercent } from "@/components/insights/parts";
import { ageLabel, regionName } from "./regions";

/**
 * A creator's measured Instagram audience in a roster cell: the country most
 * followers are in, then the gender majority and the largest age band. The
 * title spells out what it is and when Instagram was read.
 */
export function RosterAudience({ summary, compact = false }: { summary: AudienceSummary; compact?: boolean }) {
  const country = summary.country ? `${regionName(summary.country.key)} ${formatPercent(summary.country.share)}` : null;
  const gender =
    summary.women !== null && summary.men !== null
      ? summary.women >= summary.men
        ? `${formatPercent(summary.women)} women`
        : `${formatPercent(summary.men)} men`
      : null;
  const age = summary.age ? ageLabel(summary.age.key) : null;
  const detail = [gender, age].filter(Boolean).join(" · ");
  const title = `Instagram followers, read ${summary.day}${country ? `. Top country: ${country}` : ""}${detail ? `. ${detail}` : ""}`;

  return (
    <span
      className="cc-roster-audience"
      title={title}
      style={{ display: "inline-flex", flexDirection: "column", minWidth: 0, lineHeight: 1.3, gap: compact ? 0 : 1 }}
    >
      <span
        style={{
          fontSize: compact ? 12 : 13,
          fontWeight: 600,
          color: "var(--cc-text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {country ?? detail}
      </span>
      {country && detail && (
        <span
          style={{
            fontSize: 12,
            color: "var(--cc-text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {detail}
        </span>
      )}
    </span>
  );
}
