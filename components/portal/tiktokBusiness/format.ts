import type { Segment } from "@/components/insights/parts";
import type { Share } from "@/lib/platforms/tiktokBusiness";

export const countryName = (() => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return (code: string) => names.of(code) ?? code;
  } catch {
    return (code: string) => code;
  }
})();

const GENDER: Record<string, { label: string; color: string }> = {
  female: { label: "Women", color: "var(--cc-cat-2)" },
  male: { label: "Men", color: "var(--cc-cat-4)" },
  other: { label: "Other", color: "var(--cc-text-muted)" },
};

export function genderSegments(rows: Share[]): Segment[] {
  return rows.map((r) => {
    const g = GENDER[r.key.toLowerCase()];
    return { key: r.key, label: g?.label ?? r.key, value: r.share, color: g?.color ?? "var(--cc-text-muted)" };
  });
}

/** 7.4 -> "7.4s", 95 -> "1m 35s", 7300 -> "2h 1m". */
export function seconds(s: number): string {
  if (s < 60) return `${Math.round(s * 10) / 10}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}
