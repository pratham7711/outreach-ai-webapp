import { graphGet, InstagramAuthError } from "./instagram";

/**
 * Account-level and story insights for a creator's own Instagram professional
 * account, read with the creator's Facebook Login token.
 *
 * This is the rest of what `instagram_manage_insights` grants beyond per-post
 * insights (instagramAccount.ts): the account's own totals over a window,
 * its new followers each day, who its followers are (country, age, gender), and
 * the insights on stories that are still live. Nothing here is stored: the
 * routes that call it read it when someone opens the screen and return it.
 *
 * Instagram answers a request with a 400 when any one metric in it is
 * unsupported for the account (a metric retired in a Graph version, or one
 * that needs 100 followers), rather than leaving that metric out. So each
 * group is asked whole first and, when that fails, one metric at a time; a
 * metric Instagram will not report stays absent and the screen says so,
 * never 0.
 */

export const ACCOUNT_TOTAL_METRICS = [
  "reach",
  "views",
  "accounts_engaged",
  "total_interactions",
  "likes",
  "comments",
  "shares",
  "saves",
  "replies",
  "follows_and_unfollows",
] as const;
export type AccountTotalMetric = (typeof ACCOUNT_TOTAL_METRICS)[number];

export const STORY_METRICS = [
  "reach",
  "views",
  "replies",
  "shares",
  "total_interactions",
  "follows",
  "profile_visits",
] as const;
export type StoryMetric = (typeof STORY_METRICS)[number];

export const STORY_NAVIGATION_ACTIONS = ["tap_forward", "tap_back", "tap_exit", "swipe_forward"] as const;
export type StoryNavigationAction = (typeof STORY_NAVIGATION_ACTIONS)[number];

export const DEMOGRAPHIC_BREAKDOWNS = ["country", "age", "gender"] as const;
export type DemographicBreakdown = (typeof DEMOGRAPHIC_BREAKDOWNS)[number];

/** Instagram accepts at most 30 days between `since` and `until`. */
export const INSIGHTS_WINDOW_DAYS = 28;

const STORY_LIMIT = 10;

export type DemographicRow = { key: string; value: number };

export type IgAccountInsights = {
  since: string;
  until: string;
  days: number;
  totals: Partial<Record<AccountTotalMetric, number>>;
  /** New followers on each day (Meta's `follower_count`: "total number of new
   *  followers each day"), not the running total, which is `followers_count`
   *  on the account. Null when Instagram reported none: it publishes this only
   *  for accounts with at least 100 followers. */
  followerSeries: Array<{ day: string; value: number }> | null;
  /** Largest first. A breakdown Instagram withheld is an empty list; it
   *  publishes follower demographics only for accounts with 100+ followers. */
  demographics: Record<DemographicBreakdown, DemographicRow[]>;
};

export type IgStoryInsights = {
  id: string;
  mediaType: string | null;
  thumbnailUrl: string | null;
  permalink: string | null;
  postedAt: string | null;
  metrics: Partial<Record<StoryMetric, number>>;
  navigation: Partial<Record<StoryNavigationAction, number>>;
};

export type IgInsightsBundle = {
  account: IgAccountInsights;
  /** Null when the stories edge itself failed; empty when nothing is live. */
  stories: IgStoryInsights[] | null;
};

type Row = {
  name?: string;
  values?: Array<{ value?: unknown; end_time?: string }>;
  total_value?: {
    value?: unknown;
    breakdowns?: Array<{ results?: Array<{ dimension_values?: unknown[]; value?: unknown }> }>;
  };
};

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** One metric's single figure: `total_value.value` on account totals, the first
 *  `values` entry on media and story insights. */
export function metricValue(rows: Row[], name: string): number | undefined {
  const row = rows.find((r) => r.name === name);
  if (!row) return undefined;
  return finite(row.total_value?.value) ?? finite(row.values?.[0]?.value);
}

/** A breakdown's results, largest first. */
export function breakdownRows(rows: Row[], name: string): DemographicRow[] {
  const results = rows.find((r) => r.name === name)?.total_value?.breakdowns?.[0]?.results ?? [];
  return results
    .map((r) => ({ key: String(r.dimension_values?.[0] ?? ""), value: finite(r.value) }))
    .filter((r): r is DemographicRow => r.key.length > 0 && typeof r.value === "number")
    .sort((a, b) => b.value - a.value);
}

/**
 * Asks Instagram for a group of metrics, then one by one when the group is
 * refused. An auth failure is thrown: the token or the grant is gone, and
 * every other call would fail the same way.
 */
async function askMetrics(
  path: string,
  names: readonly string[],
  params: Record<string, string>,
  token: string,
  signal?: AbortSignal,
): Promise<Row[]> {
  const ask = async (metric: string): Promise<Row[] | null> => {
    try {
      const data = await graphGet(path, { ...params, metric, access_token: token }, signal);
      return Array.isArray(data?.data) ? (data.data as Row[]) : null;
    } catch (err) {
      if (err instanceof InstagramAuthError) throw err;
      return null;
    }
  };
  const whole = await ask(names.join(","));
  if (whole) return whole;
  const each = await Promise.all(names.map((n) => ask(n)));
  return each.flatMap((rows) => rows ?? []);
}

async function readAccountInsights(
  token: string,
  igUserId: string,
  now: Date,
  signal?: AbortSignal,
): Promise<IgAccountInsights> {
  const until = Math.floor(now.getTime() / 1000);
  const since = until - INSIGHTS_WINDOW_DAYS * 24 * 60 * 60;
  const window = { since: String(since), until: String(until) };
  const path = `${igUserId}/insights`;

  const [totalsRows, followerRows, ...demographicRows] = await Promise.all([
    askMetrics(path, ACCOUNT_TOTAL_METRICS, { period: "day", metric_type: "total_value", ...window }, token, signal),
    askMetrics(path, ["follower_count"], { period: "day", ...window }, token, signal),
    ...DEMOGRAPHIC_BREAKDOWNS.map((breakdown) =>
      askMetrics(
        path,
        ["follower_demographics"],
        { period: "lifetime", metric_type: "total_value", timeframe: "this_month", breakdown },
        token,
        signal,
      ),
    ),
  ]);

  const totals: Partial<Record<AccountTotalMetric, number>> = {};
  for (const name of ACCOUNT_TOTAL_METRICS) {
    const value = metricValue(totalsRows, name);
    if (value !== undefined) totals[name] = value;
  }

  const series = (followerRows.find((r) => r.name === "follower_count")?.values ?? [])
    .map((v) => ({ day: (v.end_time ?? "").slice(0, 10), value: finite(v.value) }))
    .filter((v): v is { day: string; value: number } => v.day.length === 10 && typeof v.value === "number");

  const demographics = Object.fromEntries(
    DEMOGRAPHIC_BREAKDOWNS.map((breakdown, i) => [
      breakdown,
      breakdownRows(demographicRows[i] ?? [], "follower_demographics"),
    ]),
  ) as Record<DemographicBreakdown, DemographicRow[]>;

  return {
    since: new Date(since * 1000).toISOString(),
    until: new Date(until * 1000).toISOString(),
    days: INSIGHTS_WINDOW_DAYS,
    totals,
    followerSeries: series.length > 0 ? series : null,
    demographics,
  };
}

async function readStoryInsights(
  token: string,
  story: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<IgStoryInsights> {
  const id = String(story.id);
  const path = `${id}/insights`;
  const [rows, navRows] = await Promise.all([
    askMetrics(path, STORY_METRICS, {}, token, signal),
    askMetrics(path, ["navigation"], { breakdown: "story_navigation_action_type" }, token, signal),
  ]);

  const metrics: Partial<Record<StoryMetric, number>> = {};
  for (const name of STORY_METRICS) {
    const value = metricValue(rows, name);
    if (value !== undefined) metrics[name] = value;
  }
  const navigation: Partial<Record<StoryNavigationAction, number>> = {};
  /* Meta's reference lists these values upper-case (TAP_FORWARD) and its
     sample response lower-case, so either is accepted. */
  for (const { key, value } of breakdownRows(navRows, "navigation")) {
    const action = key.toLowerCase();
    if ((STORY_NAVIGATION_ACTIONS as readonly string[]).includes(action)) navigation[action as StoryNavigationAction] = value;
  }

  const str = (v: unknown) => (typeof v === "string" && v ? v : null);
  return {
    id,
    mediaType: str(story.media_type),
    thumbnailUrl: str(story.thumbnail_url) ?? str(story.media_url),
    permalink: str(story.permalink),
    postedAt: str(story.timestamp),
    metrics,
    navigation,
  };
}

/** The stories still live on the account (Instagram keeps them 24 hours), each with its insights. */
async function readStories(
  token: string,
  igUserId: string,
  signal?: AbortSignal,
): Promise<IgStoryInsights[] | null> {
  let data;
  try {
    data = await graphGet(
      `${igUserId}/stories`,
      { fields: "id,media_type,media_url,thumbnail_url,permalink,timestamp", access_token: token, limit: String(STORY_LIMIT) },
      signal,
    );
  } catch (err) {
    if (err instanceof InstagramAuthError) throw err;
    return null;
  }
  if (!data || !Array.isArray(data.data)) return null;
  const live = (data.data as Array<Record<string, unknown>>).filter((s) => typeof s.id === "string").slice(0, STORY_LIMIT);
  return Promise.all(live.map((s) => readStoryInsights(token, s, signal)));
}

/** Account totals, followers by day, follower demographics and live story insights, read together. */
export async function readInstagramInsightsBundle(
  token: string,
  igUserId: string,
  { now = new Date(), signal }: { now?: Date; signal?: AbortSignal } = {},
): Promise<IgInsightsBundle> {
  const [account, stories] = await Promise.all([
    readAccountInsights(token, igUserId, now, signal),
    readStories(token, igUserId, signal),
  ]);
  return { account, stories };
}

