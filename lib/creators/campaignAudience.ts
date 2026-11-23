import {
  AUDIENCE_BREAKDOWNS,
  emptyMix,
  type AudienceBreakdown,
  type AudienceMix,
} from "@/lib/platforms/instagramAccountInsights";
import type { StoredAudience } from "./audienceSnapshots";

/**
 * A campaign's Instagram audience, estimated. Pure, for the unit tests.
 *
 * Instagram has no demographics per post, so each post's reach is shared out
 * by its creator's audience at the time it went out, and the posts are added
 * up. For each post, the first reading that covers its day is used, in this
 * order of closeness:
 *
 *   1. the people who engaged with the creator that week (engaged, this_week,
 *      read within 7 days after the post);
 *   2. that month (engaged, this_month, read within 30 days after);
 *   3. the creator's followers, from the reading nearest the post.
 *
 * A post whose creator has no reading at all is not covered, and the result
 * says how much of the reach that leaves out. Shares are of the audience
 * Instagram could describe (it leaves out people it has no data for).
 */

export type CampaignAudiencePost = {
  creatorId: string;
  postedAt: Date | string;
  /** Reach where Instagram gave it, views otherwise. */
  weight: number;
};

export type AudienceShare = { key: string; share: number; people: number };

export type CampaignAudienceBasis = "engaged_week" | "engaged_month" | "followers";

export type CampaignAudience = {
  breakdowns: Record<AudienceBreakdown, AudienceShare[]>;
  /** Reach of the posts an audience was found for, and of every post. */
  coveredWeight: number;
  totalWeight: number;
  coveredPosts: number;
  totalPosts: number;
  /** How many covered posts each kind of reading was used for. */
  basis: Record<CampaignAudienceBasis, number>;
  /** Creators with posts here and no reading at all. */
  uncoveredCreatorIds: string[];
  /** Each creator's part of it, largest first. */
  creators: CampaignAudienceCreator[];
};

export type CampaignAudienceCreator = {
  creatorId: string;
  posts: number;
  coveredPosts: number;
  weight: number;
  /** The country most of this creator's estimated audience was in. */
  topCountry: { key: string; share: number } | null;
  women: number | null;
};

const DAY_MS = 86_400_000;

function dayMs(d: Date | string): number {
  const iso = (typeof d === "string" ? d : d.toISOString()).slice(0, 10);
  return Date.parse(`${iso}T00:00:00Z`);
}

/**
 * Each row's share of the audience. Instagram lists only the top 45 cities,
 * so cities are measured against the country total (which covers nearly
 * everyone) rather than against themselves, or the top city would read as
 * a third of the audience when it is a sixth.
 */
export function sharesOf(mix: AudienceMix, breakdown: AudienceBreakdown): Map<string, number> {
  const rows = mix[breakdown];
  const own = rows.reduce((a, r) => a + r.value, 0);
  const total = breakdown === "city" ? Math.max(own, mix.country.reduce((a, r) => a + r.value, 0)) : own;
  const out = new Map<string, number>();
  if (total <= 0) return out;
  for (const r of rows) out.set(r.key, r.value / total);
  return out;
}

export function pickAudience(
  readings: readonly StoredAudience[],
  postedAt: Date | string,
): { basis: CampaignAudienceBasis; mix: AudienceMix } | null {
  const post = dayMs(postedAt);
  const usable = readings.filter((r) => !emptyMix(r.mix));
  const within = (r: StoredAudience, days: number) => {
    const d = dayMs(r.day);
    return d >= post && d - post <= days * DAY_MS;
  };
  const earliest = (rs: StoredAudience[]) => [...rs].sort((a, b) => dayMs(a.day) - dayMs(b.day))[0];

  const week = usable.filter((r) => r.audience === "engaged" && r.timeframe === "this_week" && within(r, 7));
  if (week.length) return { basis: "engaged_week", mix: earliest(week).mix };
  const month = usable.filter((r) => r.audience === "engaged" && r.timeframe === "this_month" && within(r, 30));
  if (month.length) return { basis: "engaged_month", mix: earliest(month).mix };
  const followers = usable.filter((r) => r.audience === "followers");
  if (followers.length) {
    const nearest = [...followers].sort((a, b) => Math.abs(dayMs(a.day) - post) - Math.abs(dayMs(b.day) - post))[0];
    return { basis: "followers", mix: nearest.mix };
  }
  return null;
}

export function campaignAudience(
  posts: readonly CampaignAudiencePost[],
  readingsByCreator: ReadonlyMap<string, readonly StoredAudience[]>,
): CampaignAudience {
  const sums = Object.fromEntries(AUDIENCE_BREAKDOWNS.map((b) => [b, new Map<string, number>()])) as Record<
    AudienceBreakdown,
    Map<string, number>
  >;
  const covered = Object.fromEntries(AUDIENCE_BREAKDOWNS.map((b) => [b, 0])) as Record<AudienceBreakdown, number>;
  const basis: Record<CampaignAudienceBasis, number> = { engaged_week: 0, engaged_month: 0, followers: 0 };
  const uncovered = new Set<string>();
  let coveredWeight = 0;
  let totalWeight = 0;
  let coveredPosts = 0;
  const perCreator = new Map<string, { posts: number; coveredPosts: number; weight: number; country: Map<string, number>; gender: Map<string, number> }>();

  for (const post of posts) {
    const weight = Number.isFinite(post.weight) && post.weight > 0 ? post.weight : 0;
    totalWeight += weight;
    const mine = perCreator.get(post.creatorId) ?? { posts: 0, coveredPosts: 0, weight: 0, country: new Map(), gender: new Map() };
    perCreator.set(post.creatorId, mine);
    mine.posts++;
    mine.weight += weight;
    const picked = pickAudience(readingsByCreator.get(post.creatorId) ?? [], post.postedAt);
    if (!picked) {
      uncovered.add(post.creatorId);
      continue;
    }
    coveredPosts++;
    mine.coveredPosts++;
    for (const [key, share] of sharesOf(picked.mix, "country")) mine.country.set(key, (mine.country.get(key) ?? 0) + share * weight);
    for (const [key, share] of sharesOf(picked.mix, "gender")) mine.gender.set(key, (mine.gender.get(key) ?? 0) + share * weight);
    basis[picked.basis]++;
    coveredWeight += weight;
    if (weight === 0) continue;
    for (const b of AUDIENCE_BREAKDOWNS) {
      const shares = sharesOf(picked.mix, b);
      if (shares.size === 0) continue;
      covered[b] += weight;
      for (const [key, share] of shares) sums[b].set(key, (sums[b].get(key) ?? 0) + share * weight);
    }
  }

  const breakdowns = Object.fromEntries(
    AUDIENCE_BREAKDOWNS.map((b) => [
      b,
      [...sums[b].entries()]
        .map(([key, people]) => ({ key, people: Math.round(people), share: covered[b] > 0 ? people / covered[b] : 0 }))
        .sort((x, y) => y.people - x.people),
    ]),
  ) as Record<AudienceBreakdown, AudienceShare[]>;

  /* A creator counts as uncovered only when none of their posts was. */
  const coveredCreators = new Set(
    posts.filter((p) => pickAudience(readingsByCreator.get(p.creatorId) ?? [], p.postedAt)).map((p) => p.creatorId),
  );

  const creators: CampaignAudienceCreator[] = [...perCreator.entries()]
    .map(([creatorId, c]) => {
      const countryTotal = [...c.country.values()].reduce((a, v) => a + v, 0);
      const top = [...c.country.entries()].sort((a, b) => b[1] - a[1])[0];
      const genderTotal = [...c.gender.values()].reduce((a, v) => a + v, 0);
      return {
        creatorId,
        posts: c.posts,
        coveredPosts: c.coveredPosts,
        weight: Math.round(c.weight),
        topCountry: top && countryTotal > 0 ? { key: top[0], share: top[1] / countryTotal } : null,
        women: genderTotal > 0 ? (c.gender.get("F") ?? 0) / genderTotal : null,
      };
    })
    .sort((a, b) => b.weight - a.weight);

  return {
    creators,
    breakdowns,
    coveredWeight: Math.round(coveredWeight),
    totalWeight: Math.round(totalWeight),
    coveredPosts,
    totalPosts: posts.length,
    basis,
    uncoveredCreatorIds: [...uncovered].filter((id) => !coveredCreators.has(id)),
  };
}
