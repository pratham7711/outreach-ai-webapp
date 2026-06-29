import { Badge, Card } from "@pratham7711/ui";

type Confidence = "low" | "medium" | "high";

export interface AuthenticityFactor {
  label: string;
  impact: number;
  detail?: string;
}

export interface AuthenticityScoreProps {
  score: number;
  confidence?: Confidence;
  factors: AuthenticityFactor[];
  compact?: boolean;
}

type Tier = {
  variant: "success" | "warning" | "danger";
  token: string;
  label: string;
};

function tierForScore(score: number): Tier {
  if (score >= 80) {
    return { variant: "success", token: "var(--cc-success)", label: "Authentic" };
  }
  if (score >= 60) {
    return { variant: "warning", token: "var(--cc-warning)", label: "Mixed signals" };
  }
  return { variant: "danger", token: "var(--cc-danger)", label: "Suspicious" };
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

export function AuthenticityScore({ score, confidence, factors, compact }: AuthenticityScoreProps) {
  const tier = tierForScore(score);
  const hasFactors = factors.length > 0;
  const showBreakdown = !compact && hasFactors;

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          role="img"
          aria-label={`Authenticity score ${score} of 100`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 56,
            height: 56,
            borderRadius: 12,
            border: `2px solid ${tier.token}`,
            color: tier.token,
            background: "var(--cc-card)",
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          {score}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <Badge variant={tier.variant}>{tier.label}</Badge>
          {confidence ? (
            <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
              {CONFIDENCE_LABEL[confidence]}
            </span>
          ) : null}
        </div>
      </div>

      {showBreakdown ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>
            Why this score
          </h4>
          <ul
            data-testid="authenticity-factors"
            style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 }}
          >
            {factors.map((factor, index) => {
              const positive = factor.impact >= 0;
              const directionToken = positive ? "var(--cc-success)" : "var(--cc-danger)";
              const directionSymbol = positive ? "▲" : "▼";
              const directionWord = positive ? "Raises score" : "Lowers score";
              return (
                <li
                  key={`${factor.label}-${index}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    paddingBottom: 8,
                    borderBottom: "1px solid var(--cc-border)",
                  }}
                >
                  <span aria-hidden="true" style={{ color: directionToken, fontSize: 12, lineHeight: "18px" }}>
                    {directionSymbol}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                      {factor.label}
                      <span style={{ marginLeft: 8, fontSize: 11, fontWeight: 500, color: "var(--cc-text-muted)" }}>
                        {directionWord} ({positive ? "+" : ""}{factor.impact})
                      </span>
                    </span>
                    {factor.detail ? (
                      <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{factor.detail}</span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
