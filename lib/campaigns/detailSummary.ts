import { fieldMetricValue, rollupEngagement } from "@/lib/metricDisplay";
import { isUnattributedCreator } from "@/lib/posts/unattributedName";

/**
 * What the campaign page's sections need from the campaign's posts, built on
 * the server.
 *
 * GET /api/campaigns/[id] used to return every Post column of every post so
 * the page could total them in the browser: 1,283,680 bytes on the largest
 * campaign (492 posts), 1,259,098 of it the posts array, re-fetched whole
 * after every edit. The page read that array for exactly three things -- the
 * creator roster, the Overview and Analytics totals, and the per-platform and
 * per-creator chart rows -- and every one of them is below, moved here
 * unchanged from app/(dashboard)/campaigns/[id]/page.tsx so the figures cannot
 * move: same functions, same order of posts, same tie-breaks.
 *
 * The Posts tab never used the array; it has always read /posts.
 */

/** The creator fields the roster renders (RosterTable) and nothing else. */
export const ROSTER_CREATOR_SELECT = {
  id: true,
  name: true,
  handle: true,
  platform: true,
  avatarUrl: true,
  followersCount: true,
  rate: true,
} as const;

export type RosterCreator = {
  id: string;
  name: string;
  handle: string;
  platform: string;
  avatarUrl: string | null;
  followersCount: number;
  rate: number | null;
};

// A campaign's creator roster, merged from both sources: activations (formally
// assigned) and posts (actually delivered). Imported CreatorCore campaigns have
// only the latter, so an activations-only list left 506 of 512 campaigns
// showing "No creators yet" beside dozens of real posts.
export type RosterEntry = {
  creator: RosterCreator;
  activationStatus: string | null;
  deliverableDueDate: string | Date | null;
  posts: number;
  views: number;
};

export type SummaryActivation = {
  status: string;
  deliverableDueDate: string | Date | null;
  creator: RosterCreator;
};

export type SummaryPost = {
  platform: string;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  savesCount: number;
  lastSyncedAt: string | Date | null;
  platformMetrics: unknown;
  creator: RosterCreator;
};

export function buildRoster(activations: readonly SummaryActivation[], posts: readonly SummaryPost[]): RosterEntry[] {
  const byCreator = new Map<string, RosterEntry>();
  for (const act of activations) {
    byCreator.set(act.creator.id, {
      creator: act.creator,
      activationStatus: act.status,
      // Carried through so the roster can offer a Due column. This was read off
      // the activation and then dropped.
      deliverableDueDate: act.deliverableDueDate,
      posts: 0,
      views: 0,
    });
  }
  for (const post of posts) {
    /* The Unattributed holding row is a filing place, not a creator on the
       campaign: it was listed here as "Unattributed Instagram posts" and
       counted in "N creators". Its posts stay in every total. */
    if (!post.creator || isUnattributedCreator(post.creator)) continue;
    const entry = byCreator.get(post.creator.id) ?? {
      creator: post.creator,
      activationStatus: null,
      deliverableDueDate: null,
      posts: 0,
      views: 0,
    };
    entry.posts += 1;
    entry.views += post.viewsCount ?? 0;
    byCreator.set(post.creator.id, entry);
  }
  return [...byCreator.values()].sort((a, b) => b.views - a.views || b.posts - a.posts);
}

/** The Analytics section's creator chart shows the leaders only; see summarizeCampaignPosts. */
export const TOP_CREATOR_BARS = 10;

export type CampaignPostSummary = {
  /** Every post on the campaign. */
  posts: number;
  /** Sum of viewsCount over every post. */
  views: number;
  /** Posts whose views are known -- the Overview tile's coverage note. */
  viewsKnownPosts: number;
  /** Sum of likesCount over every post; shown only when `likesMeasured`. */
  likes: number;
  likesMeasured: boolean;
  /** rollupEngagement: null when no post on the campaign has been measured. */
  engagements: number | null;
  /** A fraction, as rollupEngagement returns it. */
  engagementRate: number | null;
  /** Per platform, in the order the platform first appears among the posts. */
  platforms: { platform: string; views: number; likes: number; posts: number }[];
  /** Attributed creators with at least one post. */
  creatorCount: number;
  /** The TOP_CREATOR_BARS leaders by measured views, then likes. Full names. */
  topCreators: { name: string; views: number | null; likes: number | null }[];
};

export function summarizeCampaignPosts(posts: readonly SummaryPost[]): CampaignPostSummary {
  const views = posts.reduce((s, p) => s + p.viewsCount, 0);
  const viewsKnownPosts = posts.filter(
    (p) => fieldMetricValue(p.viewsCount, p.lastSyncedAt, p.platformMetrics, "views") !== null,
  ).length;
  const likes = posts.reduce((s, p) => s + p.likesCount, 0);
  // Likes are summed straight off the column, whose default is 0, so a campaign
  // whose likes were never read showed "Total Likes 0". Shown only when at
  // least one post's likes were actually measured.
  const likesMeasured = posts.some(
    (p) => fieldMetricValue(p.likesCount, p.lastSyncedAt, p.platformMetrics, "likes") !== null,
  );
  /* The product's one engagement-rate definition, shared with the Posts tab, the
     Performance tab and the client report. */
  const engagement = rollupEngagement(posts);

  // Platform breakdown for analytics
  const platformStats = posts.reduce((acc, p) => {
    if (!acc[p.platform]) acc[p.platform] = { views: 0, likes: 0, posts: 0 };
    acc[p.platform].views += p.viewsCount;
    acc[p.platform].likes += p.likesCount;
    acc[p.platform].posts += 1;
    return acc;
  }, {} as Record<string, { views: number; likes: number; posts: number }>);

  /* Per-creator breakdown for analytics. Keyed by creator, not by name -- two
     creators called the same drew as one bar -- and each counter summed only
     over the posts that measured it, so a creator whose likes (or, on Instagram
     photos, views) were never read gets no bar rather than a bar at 0. */
  const creatorStats = posts.reduce((acc, p) => {
    if (isUnattributedCreator(p.creator)) return acc;
    const key = p.creator?.id ?? "unknown";
    if (!acc[key]) acc[key] = { name: p.creator?.name ?? "Unknown", views: null, likes: null, posts: 0 };
    const v = fieldMetricValue(p.viewsCount, p.lastSyncedAt, p.platformMetrics, "views");
    const l = fieldMetricValue(p.likesCount, p.lastSyncedAt, p.platformMetrics, "likes");
    if (v !== null) acc[key].views = (acc[key].views ?? 0) + v;
    if (l !== null) acc[key].likes = (acc[key].likes ?? 0) + l;
    acc[key].posts += 1;
    return acc;
  }, {} as Record<string, { name: string; views: number | null; likes: number | null; posts: number }>);

  /* The leaders only. Every creator used to get a bar pair, in post order: a
     120-creator campaign drew 240 bars into a 240px card, so no label could be
     read, and recharts measured every one of those 120 tick labels in the DOM. */
  const topCreators = Object.values(creatorStats)
    .sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || (b.likes ?? -1) - (a.likes ?? -1))
    .slice(0, TOP_CREATOR_BARS)
    .map((s) => ({ name: s.name, views: s.views, likes: s.likes }));

  return {
    posts: posts.length,
    views,
    viewsKnownPosts,
    likes,
    likesMeasured,
    engagements: engagement.engagements,
    engagementRate: engagement.rate,
    platforms: Object.entries(platformStats).map(([platform, s]) => ({ platform, ...s })),
    creatorCount: Object.keys(creatorStats).length,
    topCreators,
  };
}
