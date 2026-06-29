import { Badge, Card } from "@pratham7711/ui";

type Severity = "low" | "medium" | "high";

export interface AnomalyAlert {
  type: string;
  severity: Severity;
  detail: string;
  delta?: number;
}

export interface AnomalyAlertsProps {
  alerts: AnomalyAlert[];
  emptyLabel?: string;
}

type SeverityMeta = {
  variant: "danger" | "warning" | "neutral";
  token: string;
  word: string;
  rank: number;
};

const SEVERITY_META: Record<Severity, SeverityMeta> = {
  high: { variant: "danger", token: "var(--cc-danger)", word: "High", rank: 0 },
  medium: { variant: "warning", token: "var(--cc-warning)", word: "Medium", rank: 1 },
  low: { variant: "neutral", token: "var(--cc-text-muted)", word: "Low", rank: 2 },
};

const TYPE_LABEL: Record<string, string> = {
  GEOGRAPHIC_ANOMALY: "Geographic anomaly",
  ENGAGEMENT_DROP: "Engagement drop",
  AUTHENTICITY_DROP: "Authenticity drop",
  FOLLOWER_SPIKE: "Follower spike",
};

function labelForType(type: string): string {
  return TYPE_LABEL[type] ?? type;
}

function formatDelta(delta: number): string {
  if (!Number.isFinite(delta)) return "";
  const rounded = Math.round(delta * 100) / 100;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}`;
}

export function AnomalyAlerts({ alerts, emptyLabel }: AnomalyAlertsProps) {
  const resolvedEmptyLabel = emptyLabel ?? "No anomalies detected";

  if (alerts.length === 0) {
    return (
      <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div
          data-testid="anomaly-empty"
          role="status"
          aria-label={resolvedEmptyLabel}
          style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--cc-success)" }}
        >
          <span aria-hidden="true" style={{ fontSize: 16, lineHeight: "20px" }}>
            ✓
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{resolvedEmptyLabel}</span>
        </div>
      </Card>
    );
  }

  const ordered = alerts
    .map((alert, index) => ({ alert, index }))
    .sort((a, b) => {
      const rankDiff = SEVERITY_META[a.alert.severity].rank - SEVERITY_META[b.alert.severity].rank;
      if (rankDiff !== 0) return rankDiff;
      return a.index - b.index;
    })
    .map((entry) => entry.alert);

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <ul
        data-testid="anomaly-list"
        style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}
      >
        {ordered.map((alert, index) => {
          const meta = SEVERITY_META[alert.severity];
          const hasDelta = typeof alert.delta === "number" && Number.isFinite(alert.delta);
          return (
            <li
              key={`${alert.type}-${index}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                paddingBottom: 8,
                borderBottom: "1px solid var(--cc-border)",
              }}
            >
              <Badge variant={meta.variant} aria-label={`${meta.word} severity`}>
                {meta.word}
              </Badge>
              <span style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                  {labelForType(alert.type)}
                  {hasDelta ? (
                    <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: meta.token }}>
                      ({formatDelta(alert.delta as number)})
                    </span>
                  ) : null}
                </span>
                <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{alert.detail}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
