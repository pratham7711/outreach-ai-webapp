import { Badge, Card } from "@pratham7711/ui";
import { CheckCircle2 } from "lucide-react";

export interface DataQualityResult {
  score: number;
  confidence: "low" | "medium" | "high";
  flags: string[];
  usable: boolean;
}

export interface DataQualityPanelProps {
  result: DataQualityResult;
  source?: string;
  recordLabel?: string;
}

type Confidence = "low" | "medium" | "high";

type ConfidenceMeta = {
  word: string;
  token: string;
};

const CONFIDENCE_META: Record<Confidence, ConfidenceMeta> = {
  high: { word: "High", token: "var(--cc-success)" },
  medium: { word: "Medium", token: "var(--cc-warning)" },
  low: { word: "Low", token: "var(--cc-text-muted)" },
};

const FLAG_LABEL: Record<string, string> = {
  EMPTY: "No data found",
  MISSING_REQUIRED: "Missing required fields",
  LOW_COMPLETENESS: "Low field completeness",
  STALE: "Data may be stale",
  SUSPICIOUS_ZEROS: "All metrics zero (suspicious)",
};

function confidenceMeta(confidence: Confidence): ConfidenceMeta {
  return CONFIDENCE_META[confidence] ?? CONFIDENCE_META.low;
}

function labelForFlag(code: string): string {
  return FLAG_LABEL[code] ?? code;
}

function formatScore(score: number): string {
  if (!Number.isFinite(score)) return "—";
  if (score < 0) return "0";
  if (score > 100) return "100";
  return String(Math.round(score));
}

export function DataQualityPanel({ result, source, recordLabel }: DataQualityPanelProps) {
  const r = result ?? ({} as Partial<DataQualityResult>);
  const usable = r.usable === true;
  const verdictWord = usable ? "Usable" : "Not usable";
  const verdictVariant = usable ? "success" : "danger";
  const verdictToken = usable ? "var(--cc-success)" : "var(--cc-danger)";

  const confidence = confidenceMeta(r.confidence as Confidence);
  const scoreText = formatScore(r.score as number);

  const flags = Array.isArray(r.flags) ? r.flags : [];

  return (
    <Card variant="outlined" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        data-testid="data-quality-verdict"
        aria-label={`${verdictWord}, ${confidence.word} confidence, score ${scoreText}`}
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
          data-testid="data-quality-confidence"
          style={{ fontSize: 14, fontWeight: 700, color: confidence.token }}
        >
          {`${confidence.word} confidence`}
        </span>
        <span
          data-testid="data-quality-score"
          style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text)" }}
        >
          {`Score ${scoreText} / 100`}
        </span>
      </div>

      {source || recordLabel ? (
        <div
          data-testid="data-quality-context"
          style={{ display: "flex", flexDirection: "column", gap: 2 }}
        >
          {recordLabel ? (
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cc-text-muted)" }}>
              {recordLabel}
            </span>
          ) : null}
          {source ? (
            <span style={{ fontSize: 12, color: "var(--cc-text-subtle)" }}>{source}</span>
          ) : null}
        </div>
      ) : null}

      {flags.length === 0 ? (
        <div
          data-testid="data-quality-clean"
          role="status"
          aria-label="No data-quality issues"
          style={{ display: "flex", alignItems: "center", gap: 8, color: "var(--cc-success)" }}
        >
          <span aria-hidden="true" style={{ fontSize: 16, lineHeight: "20px" }}>
            <CheckCircle2 size={16} color="var(--cc-success)" />
          </span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>No data-quality issues</span>
        </div>
      ) : (
        <ul
          data-testid="data-quality-flags"
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {flags.map((code, index) => (
            <li
              key={`${code}-${index}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 8,
                paddingBottom: 8,
                borderBottom: "1px solid var(--cc-border)",
              }}
            >
              <Badge variant="warning">{labelForFlag(code)}</Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
