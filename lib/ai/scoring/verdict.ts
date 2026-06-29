export interface ScoreResultLike {
  score: number;
  confidence?: "low" | "medium" | "high";
  factors: { label: string; impact: number; detail?: string }[];
}

export interface VerdictAnomaly {
  type: string;
  severity: "low" | "medium" | "high";
}

export interface VerdictInputs {
  authenticity: ScoreResultLike;
  roi?: ScoreResultLike;
  brandFit?: ScoreResultLike;
  anomalies?: VerdictAnomaly[];
}

export interface VerdictThresholds {
  authenticityFloor?: number;
  strong?: number;
  consider?: number;
}

export interface VerdictRationaleEntry {
  label: string;
  impact: number;
  detail?: string;
}

export interface CreatorVerdict {
  recommendation: "strong" | "consider" | "avoid";
  overallScore: number;
  rationale: VerdictRationaleEntry[];
  blockers: string[];
}

export const DEFAULT_AUTHENTICITY_FLOOR = 40;
export const DEFAULT_STRONG_THRESHOLD = 75;
export const DEFAULT_CONSIDER_THRESHOLD = 50;

const BLOCKED_SCORE_CAP = 40;

const WEIGHT_AUTHENTICITY = 0.5;
const WEIGHT_ROI = 0.3;
const WEIGHT_BRAND_FIT = 0.2;

function safeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function clampScore(value: number): number {
  const safe = safeNumber(value);
  if (safe < 0) return 0;
  if (safe > 100) return 100;
  return safe;
}

interface WeightedScore {
  label: string;
  score: number;
  weight: number;
}

export function composeCreatorVerdict(
  inputs: VerdictInputs,
  opts?: VerdictThresholds,
): CreatorVerdict {
  const authenticityFloor = safeNumber(opts?.authenticityFloor ?? DEFAULT_AUTHENTICITY_FLOOR);
  const strong = safeNumber(opts?.strong ?? DEFAULT_STRONG_THRESHOLD);
  const consider = safeNumber(opts?.consider ?? DEFAULT_CONSIDER_THRESHOLD);

  const authenticityScore = clampScore(inputs.authenticity.score);

  const present: WeightedScore[] = [
    { label: "Authenticity", score: authenticityScore, weight: WEIGHT_AUTHENTICITY },
  ];
  if (inputs.roi) {
    present.push({ label: "ROI", score: clampScore(inputs.roi.score), weight: WEIGHT_ROI });
  }
  if (inputs.brandFit) {
    present.push({
      label: "Brand fit",
      score: clampScore(inputs.brandFit.score),
      weight: WEIGHT_BRAND_FIT,
    });
  }

  const totalWeight = present.reduce((acc, item) => acc + item.weight, 0);
  const blended =
    totalWeight > 0
      ? present.reduce((acc, item) => acc + item.score * (item.weight / totalWeight), 0)
      : authenticityScore;

  let overallScore = Math.round(clampScore(blended));

  const blockers: string[] = [];

  if (authenticityScore < authenticityFloor) {
    blockers.push("Low authenticity");
  }

  const anomalies = Array.isArray(inputs.anomalies) ? inputs.anomalies : [];
  for (const anomaly of anomalies) {
    if (anomaly && anomaly.severity === "high") {
      blockers.push(`High-severity anomaly: ${anomaly.type}`);
    }
  }

  let recommendation: CreatorVerdict["recommendation"];
  if (blockers.length > 0) {
    recommendation = "avoid";
    overallScore = Math.min(overallScore, BLOCKED_SCORE_CAP);
  } else if (overallScore >= strong) {
    recommendation = "strong";
  } else if (overallScore >= consider) {
    recommendation = "consider";
  } else {
    recommendation = "avoid";
  }

  const rationale: VerdictRationaleEntry[] = present.map((item) => ({
    label: item.label,
    impact: Math.round((item.weight / (totalWeight > 0 ? totalWeight : 1)) * 100) / 100,
    detail: `${item.label} score ${item.score} at weight ${Math.round((item.weight / (totalWeight > 0 ? totalWeight : 1)) * 100)}%`,
  }));

  for (const blocker of blockers) {
    rationale.push({
      label: "Blocker",
      impact: -1,
      detail: blocker,
    });
  }

  return {
    recommendation,
    overallScore: clampScore(overallScore),
    rationale,
    blockers,
  };
}
