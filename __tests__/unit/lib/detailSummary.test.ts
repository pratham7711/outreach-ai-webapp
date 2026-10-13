import {
  TOP_CREATOR_BARS,
  buildRoster,
  summarizeCampaignPosts,
  type RosterCreator,
  type SummaryActivation,
  type SummaryPost,
} from "@/lib/campaigns/detailSummary";
import { fieldMetricValue, rollupEngagement, viewsCoverageNote } from "@/lib/metricDisplay";
import { isUnattributedCreator, unattributedCreatorName } from "@/lib/posts/unattributedName";

/* The campaign page used to compute these figures in the browser from the whole
   posts array. The server now computes them, and must not move a single figure:
   `pageFigures` below is the page's own code as it stood at 5bf16a2 (app/
   (dashboard)/campaigns/[id]/page.tsx), kept here as the oracle. */
function pageFigures(posts: SummaryPost[]) {
  const totalViews = posts.reduce((s, p) => s + p.viewsCount, 0);
  const viewsNote = viewsCoverageNote(
    posts.filter((p) => fieldMetricValue(p.viewsCount, p.lastSyncedAt, p.platformMetrics, "views") !== null).length,
    posts.length,
  );
  const totalLikes = posts.reduce((s, p) => s + p.likesCount, 0);
  const likesMeasured = posts.some(
    (p) => fieldMetricValue(p.likesCount, p.lastSyncedAt, p.platformMetrics, "likes") !== null,
  );
  // The page read these two fields of the rollup and nothing else.
  const { engagements, rate } = rollupEngagement(posts);
  const engagement = { engagements, rate };
  const platformStats = posts.reduce((acc, p) => {
    if (!acc[p.platform]) acc[p.platform] = { views: 0, likes: 0, posts: 0 };
    acc[p.platform].views += p.viewsCount;
    acc[p.platform].likes += p.likesCount;
    acc[p.platform].posts += 1;
    return acc;
  }, {} as Record<string, { views: number; likes: number; posts: number }>);
  const platformPieData = Object.entries(platformStats)
    .filter(([, stats]) => stats.views > 0)
    .map(([platform, stats]) => ({ name: platform, value: stats.views }));
  const creatorStats = posts.reduce((acc, p) => {
    if (isUnattributedCreator(p.creator)) return acc;
    const key = p.creator?.id ?? "unknown";
    if (!acc[key]) acc[key] = { name: p.creator?.name ?? "Unknown", views: null, likes: null, posts: 0 };
    const views = fieldMetricValue(p.viewsCount, p.lastSyncedAt, p.platformMetrics, "views");
    const likes = fieldMetricValue(p.likesCount, p.lastSyncedAt, p.platformMetrics, "likes");
    if (views !== null) acc[key].views = (acc[key].views ?? 0) + views;
    if (likes !== null) acc[key].likes = (acc[key].likes ?? 0) + likes;
    acc[key].posts += 1;
    return acc;
  }, {} as Record<string, { name: string; views: number | null; likes: number | null; posts: number }>);
  const creatorBarData = Object.values(creatorStats)
    .sort((a, b) => (b.views ?? -1) - (a.views ?? -1) || (b.likes ?? -1) - (a.likes ?? -1))
    .slice(0, 10)
    .map((stats) => ({ name: stats.name.split(" ")[0], views: stats.views, likes: stats.likes }));
  return {
    totalViews, viewsNote, totalLikes, likesMeasured, engagement,
    platformPieData, creatorCount: Object.keys(creatorStats).length, creatorBarData,
    postCount: posts.length,
  };
}

/** The same figures, read the way the page now reads them off the summary. */
function figuresFromSummary(posts: SummaryPost[]) {
  const s = summarizeCampaignPosts(posts);
  return {
    totalViews: s.views,
    viewsNote: viewsCoverageNote(s.viewsKnownPosts, s.posts),
    totalLikes: s.likes,
    likesMeasured: s.likesMeasured,
    engagement: { engagements: s.engagements, rate: s.engagementRate },
    platformPieData: s.platforms.filter((p) => p.views > 0).map((p) => ({ name: p.platform, value: p.views })),
    creatorCount: s.creatorCount,
    creatorBarData: s.topCreators.map((c) => ({ name: c.name.split(" ")[0], views: c.views, likes: c.likes })),
    postCount: s.posts,
  };
}

function creator(id: string, overrides: Partial<RosterCreator> = {}): RosterCreator {
  return {
    id, name: `Creator ${id}`, handle: `h${id}`, platform: "TIKTOK",
    avatarUrl: null, followersCount: 100, rate: null, ...overrides,
  };
}

function post(c: RosterCreator, overrides: Partial<SummaryPost> = {}): SummaryPost {
  return {
    platform: c.platform, viewsCount: 0, likesCount: 0, commentsCount: 0, sharesCount: 0, savesCount: 0,
    lastSyncedAt: "2026-10-01T00:00:00.000Z", platformMetrics: null, creator: c, ...overrides,
  };
}

/** A deterministic generator, so a failure names a reproducible dataset. */
function rng(seed: number) {
  let x = seed >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 2 ** 32;
  };
}

function randomPosts(seed: number, count: number): SummaryPost[] {
  const r = rng(seed);
  const platforms = ["TIKTOK", "INSTAGRAM", "YOUTUBE"];
  const creators = Array.from({ length: 1 + Math.floor(r() * 25) }, (_, i) => creator(`c${i}`, {
    platform: platforms[i % 3],
    // Shared first names and identical full names, which the bars must keep apart.
    name: i % 7 === 0 ? "Same Name" : `First${i % 4} Last${i}`,
  }));
  creators.push(creator("u-ig", { handle: "", name: unattributedCreatorName("INSTAGRAM"), platform: "INSTAGRAM" }));
  return Array.from({ length: count }, () => {
    const c = creators[Math.floor(r() * creators.length)];
    const synced = r() < 0.7;
    const measuredList = r() < 0.3 ? { __measured: r() < 0.5 ? ["likes"] : ["views", "likes"] } : null;
    const views = r() < 0.2 ? 0 : Math.floor(r() * 100_000);
    return post(c, {
      platform: r() < 0.9 ? c.platform : platforms[Math.floor(r() * 3)],
      viewsCount: views,
      likesCount: r() < 0.3 ? 0 : Math.floor(r() * 5_000),
      commentsCount: Math.floor(r() * 300),
      sharesCount: Math.floor(r() * 100),
      savesCount: Math.floor(r() * 50),
      lastSyncedAt: synced ? "2026-10-01T00:00:00.000Z" : null,
      platformMetrics: measuredList,
    });
  });
}

describe("summarizeCampaignPosts", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])("matches the page's own figures on dataset %i", (seed) => {
    const posts = randomPosts(seed, 1 + Math.floor(rng(seed * 31)() * 400));
    expect(figuresFromSummary(posts)).toEqual(pageFigures(posts));
  });

  it("matches on a campaign with no posts", () => {
    expect(figuresFromSummary([])).toEqual(pageFigures([]));
    expect(summarizeCampaignPosts([])).toMatchObject({ posts: 0, views: 0, likesMeasured: false, engagementRate: null });
  });

  it("keeps the unattributed holding row out of the creators but in every total", () => {
    const real = creator("a");
    const holding = creator("u", { handle: "", name: unattributedCreatorName("INSTAGRAM"), platform: "INSTAGRAM" });
    const s = summarizeCampaignPosts([post(real, { viewsCount: 10 }), post(holding, { viewsCount: 90 })]);
    expect(s.views).toBe(100);
    expect(s.posts).toBe(2);
    expect(s.creatorCount).toBe(1);
    expect(s.topCreators.map((c) => c.name)).toEqual(["Creator a"]);
  });

  it("does not call never-read likes measured", () => {
    const c = creator("a");
    const s = summarizeCampaignPosts([post(c, { likesCount: 0, lastSyncedAt: null })]);
    expect(s.likesMeasured).toBe(false);
    expect(s.engagementRate).toBeNull();
  });

  it("returns the leaders only, by views then likes", () => {
    const posts = Array.from({ length: TOP_CREATOR_BARS + 5 }, (_, i) => post(creator(`c${i}`), { viewsCount: (i + 1) * 10 }));
    const s = summarizeCampaignPosts(posts);
    expect(s.creatorCount).toBe(TOP_CREATOR_BARS + 5);
    expect(s.topCreators).toHaveLength(TOP_CREATOR_BARS);
    expect(s.topCreators[0].views).toBe((TOP_CREATOR_BARS + 5) * 10);
  });

  it("lists platforms in the order they first appear", () => {
    const s = summarizeCampaignPosts([
      post(creator("a", { platform: "YOUTUBE" }), { viewsCount: 1 }),
      post(creator("b", { platform: "TIKTOK" }), { viewsCount: 2 }),
      post(creator("c", { platform: "YOUTUBE" }), { viewsCount: 3 }),
    ]);
    expect(s.platforms.map((p) => [p.platform, p.views, p.posts])).toEqual([["YOUTUBE", 4, 2], ["TIKTOK", 2, 1]]);
  });
});

describe("buildRoster", () => {
  const activation = (c: RosterCreator, status = "ACTIVE", due: string | null = null): SummaryActivation => ({
    status, deliverableDueDate: due, creator: c,
  });

  it("merges activations and posts, one row per creator, by views then posts", () => {
    const a = creator("a");
    const b = creator("b");
    const c = creator("c");
    const roster = buildRoster(
      [activation(a, "ACTIVE", "2026-11-01"), activation(c, "INVITED")],
      [post(a, { viewsCount: 5 }), post(b, { viewsCount: 50 }), post(a, { viewsCount: 5 })],
    );
    expect(roster.map((r) => [r.creator.id, r.activationStatus, r.deliverableDueDate, r.posts, r.views])).toEqual([
      ["b", null, null, 1, 50],
      ["a", "ACTIVE", "2026-11-01", 2, 10],
      ["c", "INVITED", null, 0, 0],
    ]);
  });

  it("leaves the unattributed holding row off the roster", () => {
    const holding = creator("u", { handle: "", name: unattributedCreatorName("TIKTOK") });
    expect(buildRoster([], [post(holding, { viewsCount: 1 })])).toEqual([]);
  });
});
