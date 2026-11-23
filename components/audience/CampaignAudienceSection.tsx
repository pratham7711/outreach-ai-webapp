"use client";

import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ds";
import { FigureStrip, NUM, formatPercent, muted, type Figure } from "@/components/insights/parts";
import { formatCount } from "@/components/portal/app/ui";
import type { CampaignAudience, CampaignAudienceCreator } from "@/lib/creators/campaignAudience";
import { AudienceBreakdowns } from "./AudienceBreakdowns";
import { ageLabel, regionName } from "./regions";

/**
 * Who a campaign's Instagram posts reached, estimated from each creator's
 * audience at the time (GET /api/campaigns/[id]/audience): the headline
 * figures, the globe and breakdowns with estimated counts, and each
 * creator's part. Drawn only once at least one post is covered.
 */

type Estimate = CampaignAudience & {
  ready: true;
  posts: number;
  weightIsReach: boolean;
  creators: Array<CampaignAudienceCreator & { name: string }>;
  uncoveredCreators: Array<{ id: string; name: string }>;
};
type Body = { ready: false } | { ready: true; posts: 0 } | Estimate;

const countPosts = (n: number) => `${n} ${n === 1 ? "post" : "posts"}`;

export function CampaignAudienceSection({ campaignId }: { campaignId: string }) {
  const [body, setBody] = useState<Body | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/campaigns/${encodeURIComponent(campaignId)}/audience`, { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Body>) : null))
      .then((b) => alive && setBody(b))
      .catch(() => alive && setBody(null));
    return () => {
      alive = false;
    };
  }, [campaignId]);

  const estimate = body && body.ready && body.posts > 0 && "coveredPosts" in body ? body : null;
  const shares = useMemo(() => (estimate ? estimate.breakdowns : null), [estimate]);
  if (!estimate || !shares || estimate.coveredPosts === 0 || estimate.coveredWeight <= 0) return null;

  const unit = estimate.weightIsReach ? "reach" : "views";
  const coverage = estimate.totalWeight > 0 ? estimate.coveredWeight / estimate.totalWeight : 0;
  const topCountry = shares.country[0];
  const women = shares.gender.find((g) => g.key.toUpperCase() === "F");
  const topAge = [...shares.age].sort((a, b) => b.share - a.share)[0];
  const { engaged_week, engaged_month, followers } = estimate.basis;

  const figures: Figure[] = [
    {
      label: estimate.weightIsReach ? "Estimated reach" : "Estimated views",
      value: estimate.coveredWeight,
      note: coverage < 0.999 ? `${formatPercent(coverage)} of the campaign's Instagram ${unit}` : `All ${countPosts(estimate.coveredPosts)} on Instagram`,
    },
    topCountry
      ? { label: "Top country", value: null, display: regionName(topCountry.key), note: `${formatPercent(topCountry.share)} · ~${formatCount(topCountry.people)}` }
      : { label: "Top country", value: undefined },
    women ? { label: "Women", value: null, display: formatPercent(women.share), note: `~${formatCount(women.people)}` } : { label: "Women", value: undefined },
    topAge ? { label: "Largest age group", value: null, display: ageLabel(topAge.key), note: formatPercent(topAge.share) } : { label: "Largest age group", value: undefined },
  ];

  const basis = [
    engaged_week ? `who engaged with the creator that week (${countPosts(engaged_week)})` : null,
    engaged_month ? `who engaged with them that month (${countPosts(engaged_month)})` : null,
    followers ? `their followers (${countPosts(followers)})` : null,
  ].filter(Boolean);

  return (
    <div data-testid="campaign-audience" style={{ marginTop: 16 }}>
      <SectionCard
        title="Audience (estimated)"
        description={`From each creator's Instagram audience when their post went out · ${estimate.coveredPosts} of ${countPosts(estimate.totalPosts)}`}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <FigureStrip figures={figures} />
          <AudienceBreakdowns shares={shares} who={`Estimated ${unit}`} />
          {estimate.creators.length > 1 && <CreatorParts creators={estimate.creators} unit={unit} />}
          <details>
            <summary style={{ ...muted, fontSize: 12, cursor: "pointer" }}>How this is estimated</summary>
            <div style={{ ...muted, fontSize: 12, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <p style={{ margin: 0 }}>
                {`Instagram does not say who saw a single post, so each post's ${unit} are divided by its creator's audience at the time and then added up. Counts are ${unit}, not unique people.`}
              </p>
              {basis.length > 0 && <p style={{ margin: 0 }}>{`Audience used: ${basis.join(", ")}.`}</p>}
              {estimate.uncoveredCreators.length > 0 && (
                <p style={{ margin: 0 }}>{`Not included yet, no audience read: ${estimate.uncoveredCreators.map((c) => c.name).join(", ")}.`}</p>
              )}
            </div>
          </details>
        </div>
      </SectionCard>
    </div>
  );
}

function CreatorParts({ creators, unit }: { creators: Array<CampaignAudienceCreator & { name: string }>; unit: string }) {
  const total = creators.reduce((a, c) => a + c.weight, 0) || 1;
  const head = { fontSize: 12, fontWeight: 600, color: "var(--cc-text-muted)", textAlign: "left" as const, padding: "0 0 8px" };
  const cell = { fontSize: 13, color: "var(--cc-text)", padding: "8px 12px 8px 0", borderTop: "1px solid var(--cc-border)", whiteSpace: "nowrap" as const };
  return (
    <div>
      <p style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 10px" }}>By creator</p>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={head}>Creator</th>
              <th style={{ ...head, textAlign: "right", paddingRight: 12 }}>{unit === "reach" ? "Reach" : "Views"}</th>
              <th style={{ ...head, textAlign: "right", paddingRight: 12 }}>Share</th>
              <th style={head}>Top country</th>
              <th style={{ ...head, textAlign: "right" }}>Women</th>
            </tr>
          </thead>
          <tbody>
            {creators.map((c) => (
              <tr key={c.creatorId}>
                <td style={{ ...cell, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</td>
                <td style={{ ...cell, ...NUM, textAlign: "right" }}>{formatCount(c.weight)}</td>
                <td style={{ ...cell, ...NUM, textAlign: "right" }}>{formatPercent(c.weight / total)}</td>
                <td style={{ ...cell, color: c.topCountry ? "var(--cc-text)" : "var(--cc-text-muted)" }}>
                  {c.topCountry ? `${regionName(c.topCountry.key)} ${formatPercent(c.topCountry.share)}` : "Not read yet"}
                </td>
                <td style={{ ...cell, ...NUM, textAlign: "right", paddingRight: 0 }}>{c.women === null ? "" : formatPercent(c.women)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
