"use client";

import { useId } from "react";
import { SkeletonBlock } from "@/components/portal/app/ui";
import type { InstagramInsightsBody } from "@/lib/portal/instagramInsightsRead";
import { FigureStrip, SectionHeading, muted } from "@/components/insights/parts";
import {
  AUDIENCE_MINIMUM_NOTE,
  AudienceSection,
  INSTAGRAM_LAG_NOTE,
  INSTAGRAM_LIVE_NOTE,
  InteractionsSection,
  NewFollowersChart,
  StoriesSection,
  hasAudience,
  hasInteractions,
  hasLiveStories,
  hasNewFollowerSeries,
  instagramMissingNote,
  instagramWindowFigures,
  noStoriesNote,
  useInstagramInsights,
  type IgInsightsState,
} from "@/components/insights/instagramSections";

/**
 * Account insights and live story insights for one Instagram professional
 * account (instagram_manage_insights), read live by `url` when the panel
 * mounts, stacked in one card. The agency's creator page uses this; My stats
 * lays the same sections (instagramSections.tsx) across its dashboard. Both
 * routes return the same body. A section Instagram returned nothing for is
 * left out, not drawn empty.
 */

const rule = { marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--cc-border)" } as const;

export function InstagramInsightsView({ data, followers = null }: { data: InstagramInsightsBody; followers?: number | null }) {
  const windowId = useId();
  const dailyId = useId();
  const audience = hasAudience(data);
  const interactions = hasInteractions(data);
  return (
    <div>
      <section aria-labelledby={windowId} style={{ marginTop: 20 }}>
        <SectionHeading id={windowId} title={`Account insights, last ${data.account.days} days`} aside="From Instagram · insights" />
        <FigureStrip figures={instagramWindowFigures(data, followers)} missing={instagramMissingNote} />
      </section>

      {hasNewFollowerSeries(data) && (
        <section aria-labelledby={dailyId} style={rule}>
          <SectionHeading id={dailyId} title="New followers per day" aside={`Last ${data.account.days} days`} />
          <NewFollowersChart data={data} height={180} />
        </section>
      )}

      {(audience || interactions) && (
        <div className={`grid grid-cols-1 ${audience && interactions ? "md:grid-cols-2" : ""}`} style={{ ...rule, gap: "28px 40px" }}>
          <AudienceSection data={data} />
          <InteractionsSection data={data} />
        </div>
      )}

      <div style={rule}>
        {hasLiveStories(data) ? <StoriesSection data={data} /> : <p style={muted}>{noStoriesNote(data)}</p>}
      </div>

      <p style={{ ...muted, fontSize: 12, marginTop: 16 }}>
        {INSTAGRAM_LIVE_NOTE} {INSTAGRAM_LAG_NOTE}
        {!audience && <> {AUDIENCE_MINIMUM_NOTE}</>}
      </p>
    </div>
  );
}

/** Loads `url` once on mount and renders the insights, or the route's reason when it has none. */
export default function InstagramInsightsPanel({
  url,
  hideWhen = [],
  title,
  subtitle,
}: {
  url: string;
  hideWhen?: string[];
  /** Given, the panel draws its own card with this heading, and draws nothing until the read answers,
      nor when it is hidden -- so a creator with nothing to show never flashes an empty card. */
  title?: string;
  subtitle?: string;
}) {
  const state = useInstagramInsights(url);
  const hidden = state.status === "failed" && state.error !== null && hideWhen.includes(state.error);
  if (hidden) return null;
  if (!title) return <InsightsBody state={state} />;
  if (state.status === "loading") return null;
  return (
    <section style={{ background: "var(--cc-card)", border: "1px solid var(--cc-border)", borderRadius: 12, padding: 24, marginTop: 16 }}>
      <h2 style={{ fontSize: 15, fontWeight: 700, color: "var(--cc-text)", margin: 0 }}>{title}</h2>
      {subtitle && <p style={{ ...muted, fontSize: 12, marginTop: 4 }}>{subtitle}</p>}
      <InsightsBody state={state} />
    </section>
  );
}

function InsightsBody({ state }: { state: IgInsightsState }) {
  if (state.status === "loading")
    return (
      <div role="status" style={{ marginTop: 20 }}>
        <p style={{ ...muted, marginBottom: 12 }}>Reading account and story insights from Instagram…</p>
        <SkeletonBlock height={96} />
      </div>
    );
  if (state.status === "failed")
    return (
      <p role="alert" style={{ ...muted, marginTop: 20 }}>
        {state.reason}
      </p>
    );
  return <InstagramInsightsView data={state.data} />;
}
