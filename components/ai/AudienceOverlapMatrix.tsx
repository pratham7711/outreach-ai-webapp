import { Badge, Card } from "@pratham7711/ui";

export interface OverlapCreator {
  id: string;
  label: string;
}

export interface OverlapPair {
  a: string;
  b: string;
  overlap: number;
}

export interface OverlapDropRecord {
  id: string;
  overlapsWith: string;
  overlap: number;
}

export interface OverlapDedup {
  keep: string[];
  drop: OverlapDropRecord[];
}

export interface AudienceOverlapMatrixProps {
  creators: OverlapCreator[];
  pairs: OverlapPair[];
  dedup?: OverlapDedup;
  emptyLabel?: string;
}

const DEFAULT_EMPTY_LABEL = "No audience overlap to compare";

function safeFraction(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function formatPercent(fraction: number): string {
  return `${Math.round(safeFraction(fraction) * 100)}%`;
}

type IntensityBand = {
  word: string;
  token: string;
};

function bandForFraction(fraction: number): IntensityBand {
  const safe = safeFraction(fraction);
  if (safe >= 0.8) return { word: "Very high", token: "var(--cc-danger)" };
  if (safe >= 0.5) return { word: "High", token: "var(--cc-warning)" };
  if (safe >= 0.25) return { word: "Moderate", token: "var(--cc-text-muted)" };
  return { word: "Low", token: "var(--cc-success)" };
}

function labelFor(map: Map<string, string>, id: string): string {
  const found = map.get(id);
  return found && found.length > 0 ? found : id;
}

export function AudienceOverlapMatrix({
  creators,
  pairs,
  dedup,
  emptyLabel,
}: AudienceOverlapMatrixProps) {
  const labelMap = new Map<string, string>();
  for (const creator of creators) {
    labelMap.set(creator.id, creator.label);
  }

  const hasPairs = pairs.length > 0;
  const keepCount = dedup ? dedup.keep.length : 0;
  const dropCount = dedup ? dedup.drop.length : 0;

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
          Audience overlap
        </h3>
        <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>
          Pairwise audience overlap across creators
        </span>
      </div>

      {hasPairs ? (
        <table
          data-testid="overlap-matrix"
          style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
            color: "var(--cc-text)",
          }}
        >
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: 8, color: "var(--cc-text-muted)", fontWeight: 600 }}>
                Creator A
              </th>
              <th style={{ textAlign: "left", padding: 8, color: "var(--cc-text-muted)", fontWeight: 600 }}>
                Creator B
              </th>
              <th style={{ textAlign: "right", padding: 8, color: "var(--cc-text-muted)", fontWeight: 600 }}>
                Overlap
              </th>
              <th style={{ textAlign: "left", padding: 8, color: "var(--cc-text-muted)", fontWeight: 600 }}>
                Intensity
              </th>
            </tr>
          </thead>
          <tbody>
            {pairs.map((pair, index) => {
              const fraction = safeFraction(pair.overlap);
              const percent = formatPercent(pair.overlap);
              const band = bandForFraction(pair.overlap);
              const aLabel = labelFor(labelMap, pair.a);
              const bLabel = labelFor(labelMap, pair.b);
              return (
                <tr
                  key={`${pair.a}-${pair.b}-${index}`}
                  data-testid="overlap-row"
                  style={{ borderTop: "1px solid var(--cc-border)" }}
                >
                  <td style={{ padding: 8, fontWeight: 600 }}>{aLabel}</td>
                  <td style={{ padding: 8, fontWeight: 600 }}>{bLabel}</td>
                  <td
                    style={{
                      padding: 8,
                      textAlign: "right",
                      fontWeight: 700,
                      background: band.token,
                      color: "var(--cc-card)",
                    }}
                  >
                    <span aria-label={`${aLabel} and ${bLabel} overlap ${percent}, ${band.word}`}>
                      {percent}
                    </span>
                  </td>
                  <td style={{ padding: 8 }}>
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{band.word}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div
          data-testid="overlap-empty"
          role="status"
          style={{
            padding: 24,
            borderRadius: 12,
            border: "1px dashed var(--cc-border)",
            background: "var(--cc-card)",
            color: "var(--cc-text-muted)",
            fontSize: 13,
            textAlign: "center",
          }}
        >
          {emptyLabel && emptyLabel.length > 0 ? emptyLabel : DEFAULT_EMPTY_LABEL}
        </div>
      )}

      {dedup ? (
        <div
          data-testid="overlap-dedup"
          style={{ display: "flex", flexDirection: "column", gap: 12 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>
              {`Kept (${keepCount})`}
            </h4>
            <ul
              data-testid="overlap-kept"
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {dedup.keep.map((id, index) => (
                <li
                  key={`keep-${id}-${index}`}
                  style={{ display: "flex", alignItems: "center", gap: 8 }}
                >
                  <Badge variant="success">Kept</Badge>
                  <span style={{ fontSize: 13, color: "var(--cc-text)", fontWeight: 600 }}>
                    {labelFor(labelMap, id)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>
              {`Removed as near-duplicate (${dropCount})`}
            </h4>
            <ul
              data-testid="overlap-dropped"
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              {dedup.drop.map((record, index) => {
                const percent = formatPercent(record.overlap);
                const droppedLabel = labelFor(labelMap, record.id);
                const keptLabel = labelFor(labelMap, record.overlapsWith);
                return (
                  <li
                    key={`drop-${record.id}-${index}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <Badge variant="warning">Removed</Badge>
                    <span style={{ fontSize: 13, color: "var(--cc-text)", fontWeight: 600 }}>
                      {droppedLabel}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                      {`overlaps ${keptLabel} at ${percent}`}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
