"use client";

import { useEffect, useId, useState } from "react";
import { ExternalLink } from "lucide-react";
import { formatCount } from "@/components/portal/app/ui";
import { META_MINIMUM_SIZE_NOTE } from "@/lib/metricDisplay";
import type { InstagramInsightsBody } from "@/lib/portal/instagramInsightsRead";
import type {
  AccountTotalMetric,
  DemographicBreakdown,
  DemographicRow,
  IgStoryInsights,
  StoryMetric,
  StoryNavigationAction,
} from "@/lib/platforms/instagramAccountInsights";
import { DailyBarChart, spanLabel } from "@/components/insights/charts";
import { ColumnBars, NUM, RankBars, SectionHeading, SplitBar, Thumb, formatPercent, formatTimes, listWords, muted, type Figure, type Segment } from "@/components/insights/parts";

/**
 * The Instagram insights instagram_manage_insights grants, as sections a
 * screen composes: the 28-day figures, new followers per day, what people
 * did, who follows the account, and the stories live now. My stats lays them
 * across its dashboard; the agency's creator page stacks them in one card
 * (InstagramInsightsPanel). Both read the same route body.
 */

export type IgInsightsState =
  | { status: "loading" }
  | { status: "read"; data: InstagramInsightsBody }
  | { status: "failed"; error: string | null; reason: string };

/** Reads `url` once per mount; null reads nothing. A caller that changes the
    url remounts the reader (key it by the url) rather than reusing it. */
export function useInstagramInsights(url: string | null): IgInsightsState {
  const [state, setState] = useState<IgInsightsState>({ status: "loading" });
  useEffect(() => {
    if (!url) return;
    let live = true;
    const failed = "We couldn't read this account's insights. Reload to try again.";
    fetch(url, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        if (!live) return;
        if (res.ok && body) setState({ status: "read", data: body as InstagramInsightsBody });
        else setState({ status: "failed", error: body?.error ?? null, reason: body?.reason ?? failed });
      })
      .catch(() => live && setState({ status: "failed", error: null, reason: failed }));
    return () => {
      live = false;
    };
  }, [url]);
  return state;
}

export const INSTAGRAM_LIVE_NOTE = "Read live from Instagram just now, not saved.";
export const INSTAGRAM_LAG_NOTE = "Instagram's own figures can run up to 48 hours behind.";

const sum = (values: Array<number | undefined>) => values.reduce<number>((a, v) => a + (v ?? 0), 0);

/** The four figures the 28-day window leads with, each saying what it is
    compared with. One Instagram did not return has no value, so the strip
    leaves it out and names it underneath (instagramMissingNote). */
export function instagramWindowFigures(data: InstagramInsightsBody, followers: number | null): Figure[] {
  const t = data.account.totals;
  const series = data.account.followerSeries;
  const newFollowers = series && series.length > 0 ? sum(series.map((p) => p.value)) : null;
  return [
    {
      label: "Accounts reached",
      value: t.reach,
      note: t.reach !== undefined && followers ? `${formatTimes(t.reach / followers)} your follower count` : "Unique accounts that saw your content",
    },
    {
      label: "Views",
      value: t.views,
      note: "Every play, repeats included",
    },
    {
      label: "Accounts engaged",
      value: t.accounts_engaged,
      note:
        t.accounts_engaged !== undefined && t.reach
          ? `${formatPercent(t.accounts_engaged / t.reach)} of accounts reached`
          : "Accounts that liked, commented, shared, saved or replied",
    },
    {
      label: "New followers",
      value: newFollowers,
      note: series ? `Over ${series.length} ${series.length === 1 ? "day" : "days"} Instagram reported` : undefined,
      hint: "The sum of Instagram's new followers for each day",
    },
  ];
}

/** What the window strip left out and why: Meta holds account insights back
    below its minimum size, and returns nothing rather than a zero. */
export const instagramMissingNote = (labels: string[]) =>
  `Instagram did not return ${listWords(labels).toLowerCase()} for this account, so ${labels.length === 1 ? "it is" : "they are"} not shown. ${META_MINIMUM_SIZE_NOTE}.`;

/** Instagram returned a new-followers figure for at least one day. */
export const hasNewFollowerSeries = (data: InstagramInsightsBody | null) => Boolean(data?.account.followerSeries?.length);

/** Instagram's new followers for each day, as bars, with their total. Nothing
    when Instagram returned no days: there is no series to draw. */
export function NewFollowersChart({ data, height }: { data: InstagramInsightsBody; height?: number }) {
  const series = data.account.followerSeries;
  if (!series || series.length === 0) return null;
  const best = series.reduce((a, b) => (b.value > a.value ? b : a));
  const total = sum(series.map((p) => p.value));
  return (
    <div>
      <p style={{ ...muted, marginBottom: 12 }}>
        <strong style={{ ...NUM, color: "var(--cc-text)", fontWeight: 700 }}>{new Intl.NumberFormat("en-US").format(total)}</strong> new followers, {spanLabel(series)}
        {series.length > 1 && (
          <>
            {" "}· most on {new Date(`${best.day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })} ({formatCount(best.value)})
          </>
        )}
      </p>
      <DailyBarChart
        points={series}
        height={height}
        label={`New followers per day, ${spanLabel(series)}`}
        describe={(v) => `${v >= 0 ? "+" : "−"}${new Intl.NumberFormat("en-US").format(Math.abs(v))} new ${Math.abs(v) === 1 ? "follower" : "followers"}`}
      />
    </div>
  );
}

const INTERACTION_SEGMENTS: Array<{ metric: AccountTotalMetric; label: string; color: string }> = [
  { metric: "likes", label: "Likes", color: "var(--cc-cat-1)" },
  { metric: "comments", label: "Comments", color: "var(--cc-cat-2)" },
  { metric: "shares", label: "Shares", color: "var(--cc-cat-4)" },
  { metric: "saves", label: "Saves", color: "var(--cc-cat-5)" },
  { metric: "replies", label: "Replies", color: "var(--cc-cat-3)" },
];

function interactionParts(data: InstagramInsightsBody) {
  const t = data.account.totals;
  const segments: Segment[] = INTERACTION_SEGMENTS.filter((s) => typeof t[s.metric] === "number").map((s) => ({
    key: s.metric,
    label: s.label,
    value: t[s.metric] as number,
    color: s.color,
  }));
  const reach = t.reach;
  const rates = (["likes", "shares", "saves"] as const)
    .filter((m) => typeof t[m] === "number" && reach)
    .map((m) => [INTERACTION_SEGMENTS.find((s) => s.metric === m)!.label, ((t[m] as number) / (reach as number)) * 100] as const);
  const extra = (
    [
      ["Interactions in all", t.total_interactions],
      ["Follows and unfollows", t.follows_and_unfollows],
    ] as Array<[string, number | undefined]>
  ).filter((row): row is [string, number] => typeof row[1] === "number");
  return { segments, rates, extra };
}

/** Instagram returned at least one interaction figure for the window. */
export function hasInteractions(data: InstagramInsightsBody | null): boolean {
  if (!data) return false;
  const { segments, extra } = interactionParts(data);
  return segments.length > 0 || extra.length > 0;
}

/** What people did over the window: the interactions split, the per-reach
    rates Instagram itself tells creators to watch, and the profile figures.
    Only what Instagram returned is drawn; nothing at all when it returned none. */
export function InteractionsSection({ data }: { data: InstagramInsightsBody }) {
  const id = useId();
  const { segments, rates, extra } = interactionParts(data);
  if (segments.length === 0 && extra.length === 0) return null;
  return (
    <section aria-labelledby={id}>
      <SectionHeading id={id} title="What people did" aside={`Last ${data.account.days} days`} />
      {segments.length > 0 && <SplitBar segments={segments} label="Interactions" valueFormat="count" />}
      {rates.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "0 0 8px" }}>For every 100 accounts reached</p>
          <dl style={{ display: "grid", gridTemplateColumns: `repeat(${rates.length}, minmax(0, 1fr))`, gap: 12, margin: 0 }}>
            {rates.map(([label, per100], i) => (
              <div
                key={label}
                style={{ display: "flex", flexDirection: "column-reverse", justifyContent: "flex-end", minWidth: 0, paddingLeft: i === 0 ? 0 : 12, borderLeft: i === 0 ? "none" : "1px solid var(--cc-border)" }}
              >
                <dt style={{ fontSize: 12, color: "var(--cc-text-muted)", marginTop: 2 }}>{label.toLowerCase()}</dt>
                <dd style={{ ...NUM, margin: 0, fontSize: 22, fontWeight: 700, color: "var(--cc-text)", lineHeight: 1.15 }}>
                  {per100 < 10 ? per100.toFixed(1).replace(/\.0$/, "") : Math.round(per100)}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      {extra.length > 0 && (
        <dl style={{ margin: segments.length > 0 || rates.length > 0 ? "16px 0 0" : 0 }}>
          {extra.map(([label, value]) => (
            <div key={label} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "8px 0", borderTop: "1px solid var(--cc-border)", fontSize: 13 }}>
              <dt style={{ color: "var(--cc-text-muted)" }}>{label}</dt>
              <dd style={{ ...NUM, margin: 0, fontWeight: 700, color: "var(--cc-text)" }}>{formatCount(value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

const GENDER: Record<string, { label: string; color: string }> = {
  F: { label: "Women", color: "var(--cc-cat-2)" },
  M: { label: "Men", color: "var(--cc-cat-4)" },
  U: { label: "Not specified", color: "var(--cc-text-muted)" },
};

const countryName = (() => {
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return (code: string) => names.of(code) ?? code;
  } catch {
    return (code: string) => code;
  }
})();

const shares = (rows: DemographicRow[]) => {
  const total = rows.reduce((a, r) => a + r.value, 0) || 1;
  return (r: DemographicRow) => r.value / total;
};

/** Instagram returned at least one follower breakdown. It returns none for an
    account under 100 followers. */
export function hasAudience(data: InstagramInsightsBody | null): boolean {
  if (!data) return false;
  const d = data.account.demographics;
  return (Object.keys(d) as DemographicBreakdown[]).some((b) => d[b].length > 0);
}

export const AUDIENCE_MINIMUM_NOTE = "Instagram shares who follows an account only once it has 100 followers.";

/** Who follows the account: gender as one split, age bands in age order,
    and the five countries most of them are in. Followers, not viewers.
    Nothing when Instagram returned no breakdown. */
export function AudienceSection({ data }: { data: InstagramInsightsBody }) {
  const id = useId();
  const d = data.account.demographics;
  if (!hasAudience(data)) return null;
  const label = (t: string) => <p style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)", margin: "0 0 10px" }}>{t}</p>;
  const ageShare = shares(d.age);
  const countryShare = shares(d.country);
  return (
    <section aria-labelledby={id}>
      <SectionHeading id={id} title="Who follows you" aside="Instagram followers" />
      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          {d.gender.length > 0 && (
            <div>
              {label("Gender")}
              <SplitBar
                label="Gender"
                segments={d.gender.map((r) => ({ key: r.key, label: GENDER[r.key]?.label ?? r.key, value: r.value, color: GENDER[r.key]?.color ?? "var(--cc-text-muted)" }))}
              />
            </div>
          )}
          {d.age.length > 0 && (
            <div>
              {label("Age")}
              <ColumnBars
                label="Age"
                rows={[...d.age]
                  .sort((a, b) => (parseInt(a.key, 10) || 0) - (parseInt(b.key, 10) || 0))
                  .map((r) => ({ key: r.key, label: r.key, share: ageShare(r) }))}
              />
            </div>
          )}
          {d.country.length > 0 && (
            <div>
              {label("Top countries")}
              <RankBars rows={d.country.slice(0, 5).map((r) => ({ key: r.key, label: countryName(r.key), share: countryShare(r) }))} />
            </div>
          )}
          <p style={{ ...muted, fontSize: 12 }}>These describe your followers, not everyone who saw your posts.</p>
      </div>
    </section>
  );
}

const STORY_LABEL: Record<StoryMetric, string> = {
  reach: "Reach",
  views: "Views",
  replies: "Replies",
  shares: "Shares",
  total_interactions: "Interactions",
  follows: "Follows",
  profile_visits: "Profile visits",
};

const NAVIGATION: Array<{ action: StoryNavigationAction; label: string; color: string }> = [
  { action: "tap_forward", label: "Tapped forward", color: "var(--cc-cat-1)" },
  { action: "tap_back", label: "Tapped back", color: "var(--cc-cat-4)" },
  { action: "swipe_forward", label: "Swiped to next story", color: "var(--cc-cat-5)" },
  { action: "tap_exit", label: "Exited", color: "var(--cc-cat-3)" },
];

function postedAgo(iso: string | null, now = Date.now()): string {
  if (!iso) return "Live now";
  const hours = Math.floor((now - new Date(iso).getTime()) / 3_600_000);
  if (!Number.isFinite(hours)) return "Live now";
  if (hours < 1) return "Posted under an hour ago";
  return `Posted ${hours} ${hours === 1 ? "hour" : "hours"} ago`;
}

function StoryCard({ story }: { story: IgStoryInsights }) {
  const metrics = (Object.keys(STORY_LABEL) as StoryMetric[])
    .map((m) => [STORY_LABEL[m], story.metrics[m]] as const)
    .filter((row): row is readonly [string, number] => typeof row[1] === "number");
  const navigation: Segment[] = NAVIGATION.filter((n) => typeof story.navigation[n.action] === "number").map((n) => ({
    key: n.action,
    label: n.label,
    value: story.navigation[n.action] as number,
    color: n.color,
  }));
  return (
    <li style={{ display: "grid", gridTemplateColumns: "auto minmax(0, 1fr)", gap: "14px 16px", minWidth: 0, padding: 14, borderRadius: 14, border: "1px solid var(--cc-border)" }}>
      <span style={{ position: "relative", width: 88, height: 156, borderRadius: 10, overflow: "hidden", display: "block" }}>
        <Thumb src={story.thumbnailUrl} fill radius={10} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "4px 10px", flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--cc-text)" }}>{postedAgo(story.postedAt)}</span>
          {story.permalink && (
            <a
              href={story.permalink}
              target="_blank"
              rel="noreferrer"
              className="hover:underline underline-offset-2"
              style={{ display: "inline-flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--cc-text)", fontWeight: 500, textDecoration: "none" }}
            >
              Open <ExternalLink size={13} aria-hidden="true" />
            </a>
          )}
        </div>
        {metrics.length > 0 ? (
          <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(76px, 1fr))", gap: "10px 12px", margin: "12px 0 0" }}>
            {metrics.map(([label, value]) => (
              <div key={label} style={{ minWidth: 0 }}>
                <dt style={{ fontSize: 12, color: "var(--cc-text-muted)" }}>{label}</dt>
                <dd style={{ ...NUM, margin: "1px 0 0", fontSize: 16, fontWeight: 700, color: "var(--cc-text)" }}>{formatCount(value)}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p style={{ ...muted, marginTop: 12 }}>No figures yet. Instagram holds each one back until it reaches 5.</p>
        )}
      </div>
      {navigation.length > 0 && (
        <div style={{ gridColumn: "1 / -1", minWidth: 0 }}>
          <p style={{ fontSize: 12, color: "var(--cc-text-muted)", margin: "0 0 8px" }}>How viewers moved on</p>
          <SplitBar segments={navigation} label="How viewers moved on" valueFormat="count" />
        </div>
      )}
    </li>
  );
}

export const hasLiveStories = (data: InstagramInsightsBody | null) => Boolean(data?.stories?.length);

/** Why there is no story to show, in one line, for the screen to place where
    the stories would have been. */
export function noStoriesNote(data: InstagramInsightsBody): string {
  return data.stories === null
    ? "Instagram did not return this account's stories just now."
    : "No story is live right now. Instagram keeps a story's insights only while it is up, for 24 hours.";
}

/** Stories that are up right now. Instagram keeps a story's insights only
    while it is live, so this is the only place they can be seen. Nothing when
    none is live: the screen says so in a line (noStoriesNote). */
export function StoriesSection({ data }: { data: InstagramInsightsBody }) {
  const id = useId();
  const stories = data.stories;
  if (!stories || stories.length === 0) return null;
  const gaps = stories.some((s) => (Object.keys(STORY_LABEL) as StoryMetric[]).some((m) => s.metrics[m] === undefined));
  return (
    <section aria-labelledby={id}>
      <SectionHeading id={id} title="Stories live now" aside={`${stories.length} live · insights last 24 hours`} />
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 360px), 1fr))", gap: 12 }}>
        {stories.map((s) => (
          <StoryCard key={s.id} story={s} />
        ))}
      </ul>
      {gaps && <p style={{ ...muted, fontSize: 12, marginTop: 10 }}>Instagram holds back a story figure until it reaches 5, so some stories show fewer.</p>}
    </section>
  );
}
