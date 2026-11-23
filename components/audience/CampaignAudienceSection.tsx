"use client";

import { useEffect, useMemo, useState } from "react";
import { SectionCard } from "@/components/ds";
import { formatPercent, muted } from "@/components/insights/parts";
import type { CampaignAudience } from "@/lib/creators/campaignAudience";
import { AudienceBreakdowns } from "./AudienceBreakdowns";

/**
 * Who a campaign's Instagram posts reached, estimated from each creator's
 * audience at the time (GET /api/campaigns/[id]/audience). Drawn only once
 * at least one post is covered; it says how much of the reach that is.
 */

type Body =
  | { ready: false }
  | { ready: true; posts: 0 }
  | ({ ready: true; posts: number; weightIsReach: boolean; uncoveredCreators: Array<{ id: string; name: string }> } & CampaignAudience);

const posts = (n: number) => `${n} ${n === 1 ? "post" : "posts"}`;

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
  const shares = useMemo(
    () =>
      estimate
        ? {
            country: estimate.breakdowns.country,
            city: estimate.breakdowns.city,
            age: estimate.breakdowns.age,
            gender: estimate.breakdowns.gender,
          }
        : null,
    [estimate],
  );
  if (!estimate || !shares || estimate.coveredPosts === 0 || estimate.coveredWeight <= 0) return null;

  const coverage = estimate.totalWeight > 0 ? estimate.coveredWeight / estimate.totalWeight : 0;
  const unit = estimate.weightIsReach ? "reach" : "views";
  const { engaged_week, engaged_month, followers } = estimate.basis;

  return (
    <div data-testid="campaign-audience" style={{ marginTop: 16 }}>
      <SectionCard
        title="Audience (estimated)"
        description={`${formatPercent(coverage)} of Instagram ${unit} · ${estimate.coveredPosts} of ${estimate.totalPosts} ${estimate.totalPosts === 1 ? "post" : "posts"}`}
      >
        <AudienceBreakdowns shares={shares} who="Estimated audience" />
        <details style={{ marginTop: 18 }}>
          <summary style={{ ...muted, fontSize: 12, cursor: "pointer" }}>How this is estimated</summary>
          <div style={{ ...muted, fontSize: 12, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
            <p style={{ margin: 0 }}>
              Instagram does not say who saw a single post. Each post&rsquo;s {unit} is split by its creator&rsquo;s audience when it went out, and
              the posts are added up.
            </p>
            <p style={{ margin: 0 }}>
              {[
                engaged_week ? `${posts(engaged_week)} split by who engaged with the creator that week` : null,
                engaged_month ? `${posts(engaged_month)} by who engaged that month` : null,
                followers ? `${posts(followers)} by the creator's followers` : null,
              ]
                .filter(Boolean)
                .join("; ")}
              .
            </p>
            {estimate.uncoveredCreators.length > 0 && (
              <p style={{ margin: 0 }}>
                Not included, no audience read yet: {estimate.uncoveredCreators.map((c) => c.name).join(", ")}.
              </p>
            )}
          </div>
        </details>
      </SectionCard>
    </div>
  );
}
