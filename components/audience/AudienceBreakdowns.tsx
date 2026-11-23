"use client";

import { ColumnBars, RankBars, SplitBar, muted } from "@/components/insights/parts";
import { AudienceGlobe } from "./AudienceGlobe";
import { ageLabel, byAgeBand, regionName } from "./regions";

/**
 * One audience drawn the same way wherever it appears (a creator's followers,
 * the people who engaged with them, a campaign's estimate): a globe shaded by
 * country beside the ranked countries, then gender, age and cities.
 *
 * Shares are of the people Instagram could describe; each breakdown sums to 1
 * on its own, because Instagram leaves different people out of each.
 */

export type ShareRow = { key: string; share: number };
export type AudienceShares = { country: ShareRow[]; city: ShareRow[]; age: ShareRow[]; gender: ShareRow[] };

const GENDER: Record<string, { label: string; color: string }> = {
  F: { label: "Women", color: "var(--cc-cat-2)" },
  M: { label: "Men", color: "var(--cc-cat-4)" },
  U: { label: "Not specified", color: "var(--cc-text-muted)" },
};

/** Rows of raw counts to rows of shares, largest first. */
export function toShares(rows: Array<{ key: string; value: number }>): ShareRow[] {
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (total <= 0) return [];
  return rows.map((r) => ({ key: r.key, share: r.value / total })).sort((a, b) => b.share - a.share);
}

const subhead = (t: string) => <p style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 10px" }}>{t}</p>;

export function AudienceBreakdowns({ shares, who }: { shares: AudienceShares; /** "Followers", "Engaged audience", "Estimated audience". */ who: string }) {
  const { country, city, age, gender } = shares;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {country.length > 0 && (
        <div className="cc-audience-geo">
          <AudienceGlobe shares={country} label={`${who} by country`} />
          <div style={{ minWidth: 0 }}>
            {subhead("Top countries")}
            <RankBars rows={country.slice(0, 8).map((r) => ({ key: r.key, label: regionName(r.key), share: r.share }))} />
            {country.length > 8 && (
              <p style={{ ...muted, fontSize: 12, marginTop: 10 }}>
                And {country.length - 8} more {country.length - 8 === 1 ? "country" : "countries"}, each under {Math.max(1, Math.round(country[7].share * 100))}%.
              </p>
            )}
          </div>
        </div>
      )}
      <div className="cc-audience-grid">
        {gender.length > 0 && (
          <div>
            {subhead("Gender")}
            <SplitBar
              label="Gender"
              segments={gender.map((r) => ({
                key: r.key,
                label: GENDER[r.key.toUpperCase()]?.label ?? r.key,
                value: r.share,
                color: GENDER[r.key.toUpperCase()]?.color ?? "var(--cc-text-muted)",
              }))}
            />
          </div>
        )}
        {age.length > 0 && (
          <div>
            {subhead("Age")}
            <ColumnBars label="Age" rows={[...age].sort(byAgeBand).map((r) => ({ key: r.key, label: ageLabel(r.key), share: r.share }))} />
          </div>
        )}
        {city.length > 0 && (
          <div>
            {subhead("Top cities")}
            <RankBars rows={city.slice(0, 6).map((r) => ({ key: r.key, label: r.key.split(",")[0], share: r.share }))} />
          </div>
        )}
      </div>
    </div>
  );
}
