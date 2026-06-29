import { Badge, Card } from "@pratham7711/ui";

type Recommendation = "strong" | "consider" | "avoid";

export interface VerdictRationale {
  label: string;
  impact: number;
  detail?: string;
}

export interface CreatorVerdict {
  recommendation: Recommendation;
  overallScore: number;
  rationale: VerdictRationale[];
  blockers: string[];
}

export interface CreatorVerdictCardProps {
  creatorName: string;
  handle?: string;
  verdict: CreatorVerdict;
}

type RecommendationMeta = {
  variant: "success" | "warning" | "danger";
  token: string;
  word: string;
};

const RECOMMENDATION_META: Record<Recommendation, RecommendationMeta> = {
  strong: { variant: "success", token: "var(--cc-success)", word: "Strong" },
  consider: { variant: "warning", token: "var(--cc-warning)", word: "Consider" },
  avoid: { variant: "danger", token: "var(--cc-danger)", word: "Avoid" },
};

function safeScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 100) return 100;
  return score;
}

function safeImpact(impact: number): number {
  return Number.isFinite(impact) ? impact : 0;
}

export function CreatorVerdictCard({ creatorName, handle, verdict }: CreatorVerdictCardProps) {
  const meta = RECOMMENDATION_META[verdict.recommendation];
  const score = safeScore(verdict.overallScore);
  const hasRationale = verdict.rationale.length > 0;
  const hasBlockers = verdict.blockers.length > 0;

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>
          {creatorName}
        </h3>
        {handle ? (
          <span style={{ fontSize: 13, color: "var(--cc-text-muted)" }}>{`@${handle}`}</span>
        ) : null}
      </div>

      <div
        data-testid="verdict-recommendation"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          padding: 16,
          borderRadius: 12,
          border: `2px solid ${meta.token}`,
          background: "var(--cc-card)",
        }}
      >
        <Badge variant={meta.variant}>{meta.word}</Badge>
        <span
          role="img"
          aria-label={`Overall score ${score} of 100`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 56,
            height: 56,
            borderRadius: 12,
            border: `2px solid ${meta.token}`,
            color: meta.token,
            background: "var(--cc-card)",
            fontSize: 20,
            fontWeight: 700,
          }}
        >
          {score}
        </span>
      </div>

      {hasRationale ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <h4 style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)", margin: 0 }}>
            Why this verdict
          </h4>
          <ul
            data-testid="verdict-rationale"
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {verdict.rationale.map((item, index) => {
              const impact = safeImpact(item.impact);
              const positive = impact >= 0;
              const directionToken = positive ? "var(--cc-success)" : "var(--cc-danger)";
              const directionSymbol = positive ? "▲" : "▼";
              const directionWord = positive ? "Supports" : "Detracts";
              return (
                <li
                  key={`${item.label}-${index}`}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    paddingBottom: 8,
                    borderBottom: "1px solid var(--cc-border)",
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ color: directionToken, fontSize: 12, lineHeight: "18px" }}
                  >
                    {directionSymbol}
                  </span>
                  <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text)" }}>
                      {item.label}
                      <span
                        style={{
                          marginLeft: 8,
                          fontSize: 11,
                          fontWeight: 500,
                          color: "var(--cc-text-muted)",
                        }}
                      >
                        {directionWord} ({positive ? "+" : ""}
                        {impact})
                      </span>
                    </span>
                    {item.detail ? (
                      <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>
                        {item.detail}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {hasBlockers ? (
        <div
          data-testid="verdict-blockers"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: 16,
            borderRadius: 12,
            border: "2px solid var(--cc-danger)",
            background: "var(--cc-card)",
          }}
        >
          <h4 style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-danger)", margin: 0 }}>
            Blockers
          </h4>
          <ul
            style={{
              listStyle: "none",
              margin: 0,
              padding: 0,
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            {verdict.blockers.map((blocker, index) => (
              <li
                key={`${blocker}-${index}`}
                style={{ display: "flex", alignItems: "flex-start", gap: 8 }}
              >
                <span
                  aria-hidden="true"
                  style={{ color: "var(--cc-danger)", fontSize: 12, lineHeight: "18px" }}
                >
                  ✕
                </span>
                <span style={{ fontSize: 13, color: "var(--cc-text)" }}>{blocker}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Card>
  );
}
