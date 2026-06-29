import { Badge, Card } from "@pratham7711/ui";

type Severity = "low" | "medium" | "high";

export type RiskLevel = "low" | "medium" | "high";

export interface BrandSafetyFlag {
  code: string;
  severity: Severity;
  detail: string;
}

export interface BrandSafetyFlagsProps {
  safe: boolean;
  riskLevel: RiskLevel;
  score: number;
  flags: BrandSafetyFlag[];
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

type RiskMeta = {
  token: string;
  word: string;
};

const RISK_META: Record<RiskLevel, RiskMeta> = {
  low: { token: "var(--cc-success)", word: "Low risk" },
  medium: { token: "var(--cc-warning)", word: "Medium risk" },
  high: { token: "var(--cc-danger)", word: "High risk" },
};

const TYPE_LABEL: Record<string, string> = {
  RESTRICTED_CATEGORY: "Restricted category",
  ADULT_CONTENT: "Adult content",
  HATE_SPEECH: "Hate speech",
  VIOLENCE: "Violent content",
  PROFANITY: "Profanity",
  CONTROVERSIAL_TOPIC: "Controversial topic",
  COMPETITOR_MENTION: "Competitor mention",
  REGULATED_PRODUCT: "Regulated product",
};

function labelForCode(code: string): string {
  return TYPE_LABEL[code] ?? code;
}

function safeScore(score: number): number {
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 100) return 100;
  return Math.round(score);
}

function severityMeta(severity: Severity): SeverityMeta {
  return SEVERITY_META[severity] ?? SEVERITY_META.low;
}

export function BrandSafetyFlags({
  safe,
  riskLevel,
  score,
  flags,
  emptyLabel,
}: BrandSafetyFlagsProps) {
  const resolvedEmptyLabel = emptyLabel ?? "No brand-safety flags";
  const verdictWord = safe ? "Brand-safe" : "Not brand-safe";
  const verdictVariant = safe ? "success" : "danger";
  const verdictToken = safe ? "var(--cc-success)" : "var(--cc-danger)";
  const risk = RISK_META[riskLevel] ?? RISK_META.high;
  const displayScore = safeScore(score);
  const scoreText = `Safety score ${displayScore} / 100`;
  const flagList = flags ?? [];

  const ordered = flagList
    .map((flag, index) => ({ flag, index }))
    .sort((a, b) => {
      const rankDiff = severityMeta(a.flag.severity).rank - severityMeta(b.flag.severity).rank;
      if (rankDiff !== 0) return rankDiff;
      return a.index - b.index;
    })
    .map((entry) => entry.flag);

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        data-testid="brand-safety-verdict"
        aria-label={`${verdictWord}, ${risk.word}, ${scoreText}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 16,
          flexWrap: "wrap",
          padding: 16,
          borderRadius: 12,
          border: `2px solid ${verdictToken}`,
          background: "var(--cc-card)",
        }}
      >
        <Badge variant={verdictVariant}>{verdictWord}</Badge>
        <span
          data-testid="brand-safety-risk"
          style={{ fontSize: 14, fontWeight: 700, color: risk.token }}
        >
          {risk.word}
        </span>
        <span
          data-testid="brand-safety-score"
          style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}
        >
          {scoreText}
        </span>
      </div>

      {ordered.length === 0 ? (
        <div
          data-testid="brand-safety-clean"
          role="status"
          aria-label={resolvedEmptyLabel}
          style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--cc-success)" }}
        >
          <span aria-hidden="true" style={{ fontSize: 16, lineHeight: "20px" }}>
            ✓
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{resolvedEmptyLabel}</span>
        </div>
      ) : (
        <ul
          data-testid="brand-safety-flags"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {ordered.map((flag, index) => {
            const meta = severityMeta(flag.severity);
            return (
              <li
                key={`${flag.code}-${index}`}
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
                    {labelForCode(flag.code)}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{flag.detail}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
