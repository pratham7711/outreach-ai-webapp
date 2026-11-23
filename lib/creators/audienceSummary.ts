import type { AudienceMix, DemographicRow } from "@/lib/platforms/instagramAccountInsights";

/**
 * The one-line version of an audience the roster shows: its largest country,
 * how many are women and men, and its largest age band, each as a share of
 * the people Instagram could describe. Pure.
 */

export type AudienceSummary = {
  country: { key: string; share: number } | null;
  /** Instagram's gender keys are F, M and U (unknown). */
  women: number | null;
  men: number | null;
  age: { key: string; share: number } | null;
  /** YYYY-MM-DD the reading was taken. */
  day: string;
};

function top(rows: DemographicRow[]): { key: string; share: number } | null {
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (total <= 0) return null;
  const best = [...rows].sort((a, b) => b.value - a.value)[0];
  return { key: best.key, share: best.value / total };
}

export function summarizeAudience(mix: AudienceMix, day: string): AudienceSummary | null {
  const genderTotal = mix.gender.reduce((a, r) => a + r.value, 0);
  const genderShare = (k: string) => (genderTotal > 0 ? (mix.gender.find((r) => r.key.toUpperCase() === k)?.value ?? 0) / genderTotal : null);
  const summary: AudienceSummary = {
    country: top(mix.country),
    women: genderShare("F"),
    men: genderShare("M"),
    age: top(mix.age),
    day,
  };
  return summary.country || summary.women !== null || summary.age ? summary : null;
}
