import { Badge, Card } from "@pratham7711/ui";
import { AuthenticityScore, type AuthenticityFactor } from "@/components/ai/AuthenticityScore";

type Confidence = "low" | "medium" | "high";

export interface CreatorScoreSection {
  score: number;
  confidence?: Confidence;
  factors: AuthenticityFactor[];
}

export interface CreatorScoreCardProps {
  creatorName: string;
  handle?: string;
  authenticity: CreatorScoreSection;
  roi?: CreatorScoreSection;
  brandFit?: CreatorScoreSection;
  compact?: boolean;
}

type ChipVariant = "success" | "warning" | "danger";

function chipVariantForScore(score: number): ChipVariant {
  if (score >= 80) return "success";
  if (score >= 60) return "warning";
  return "danger";
}

function chipTokenForScore(score: number): string {
  if (score >= 80) return "var(--cc-success)";
  if (score >= 60) return "var(--cc-warning)";
  return "var(--cc-danger)";
}

const CONFIDENCE_LABEL: Record<Confidence, string> = {
  low: "Low confidence",
  medium: "Medium confidence",
  high: "High confidence",
};

interface ScoreChipProps {
  label: string;
  section: CreatorScoreSection;
}

function ScoreChip({ label, section }: ScoreChipProps) {
  const variant = chipVariantForScore(section.score);
  const token = chipTokenForScore(section.score);
  return (
    <div
      aria-label={`${label} score ${section.score} of 100`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: 8,
        borderRadius: 8,
        border: "1px solid var(--cc-border)",
        background: "var(--cc-card)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: 32,
          height: 32,
          borderRadius: 8,
          border: `2px solid ${token}`,
          color: token,
          fontSize: 13,
          fontWeight: 700,
        }}
      >
        {section.score}
      </span>
      <span style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <Badge variant={variant} size="sm">
          {label}
        </Badge>
        {section.confidence ? (
          <span style={{ fontSize: 11, color: "var(--cc-text-muted)" }}>
            {CONFIDENCE_LABEL[section.confidence]}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function CreatorScoreCard({
  creatorName,
  handle,
  authenticity,
  roi,
  brandFit,
  compact,
}: CreatorScoreCardProps) {
  const hasSecondary = Boolean(roi) || Boolean(brandFit);

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

      <AuthenticityScore
        score={authenticity.score}
        confidence={authenticity.confidence}
        factors={authenticity.factors}
        compact={compact}
      />

      {hasSecondary ? (
        <div
          data-testid="creator-secondary-scores"
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          {roi ? <ScoreChip label="ROI" section={roi} /> : null}
          {brandFit ? <ScoreChip label="Brand fit" section={brandFit} /> : null}
        </div>
      ) : null}
    </Card>
  );
}
