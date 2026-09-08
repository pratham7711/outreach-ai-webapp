import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import {
  computeCampaignEmv,
  computeEngagementRate,
  sumEngagements,
} from "@/lib/metrics";
import { metricValue, unwrittenMetricValue, fieldMetricValue } from "@/lib/metricDisplay";
import type { MetricField } from "@/lib/metricDisplay";
import { isPostRemoved } from "@/lib/postRemoval";
import type { SharePlatform } from "@/lib/reports/shareVisibility";
import type { ActivationStatus } from "@/lib/generated/prisma/client";

/**
 * The rest of the cache key says which data the entry holds. This says which
 * shape it holds, and without it a deploy that adds a field reads the previous
 * deploy's payload straight back out of Vercel's Data Cache, which outlives the
 * deployment that wrote it.
 *
 * That is not hypothetical: adding `at` to usageSeries shipped alongside the
 * AudioCard axis label that reads it, the stamp had not moved since the deploy
 * before, and every share link died on `p.at.slice` of undefined until the
 * deployment was rolled back. A version constant would have caught it only if
 * someone remembered to bump it, which is the same discipline that just failed;
 * the deployment id needs no one to remember anything. The cost is one
 * uncached render per campaign per deploy.
 */
const BUILD_KEY = process.env.VERCEL_DEPLOYMENT_ID ?? "local";

type SeriesPlatform = "TIKTOK" | "INSTAGRAM" | "YOUTUBE";
const SERIES_PLATFORMS: SeriesPlatform[] = ["TIKTOK", "INSTAGRAM", "YOUTUBE"];

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type CampaignPerformance = {
  currency: string;
  kpis: {
    views: number;
    /** null when no post in the campaign has had its engagement fetched. */
    engagements: number | null;
    engagementRate: number | null;
    emv: number;
    /**
     * The per-counter totals CreatorCore's client report breaks out, rather than
     * only the combined engagement figure. Each is null when no post on the
     * campaign has that counter measured -- saves and downloads usually are,
     * because the public TikTok payload does not carry them -- so a tile is
     * absent instead of claiming a campaign earned zero saves.
     */
    posts: number;
    /**
     * Posts still live on their platform, or null unless every post on the
     * campaign has been reached at least once.
     *
     * fetchState is only set by a sync that actually got a post's numbers back,
     * so a null there means "we have never managed to look", not "gone". A count
     * taken over just the reached posts would be read against the total anyway --
     * "17 posts, 16 live" says a creator deleted one -- so a partial answer is
     * worse than no tile.
     */
    livePosts: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
    saves: number | null;
    downloads: number | null;
  };
  timeSeries: { date: string; TIKTOK: number; INSTAGRAM: number; YOUTUBE: number }[];
  platformSplit: { platform: string; views: number; posts: number }[];
  leaderboard: {
    creatorId: string;
    name: string;
    avatarUrl: string | null;
    posts: number;
    views: number;
    engagements: number | null;
    engagementRate: number | null;
    emv: number;
    /**
     * The creator's activation status on this campaign, or null when they have
     * no activation row — which is the case for every imported campaign, since
     * CreatorCore's export carried posts but not activations. Null means "not
     * tracked here", never a default status.
     */
    status: ActivationStatus | null;
  }[];
  /**
   * Every post on the campaign, newest metrics first, because a client report is
   * fundamentally a list of posts: CreatorCore's shows all seventeen of them with
   * their own counters, where ours showed a ten-row creator leaderboard and
   * nothing else. The leaderboard stays -- it answers a different question -- but
   * it is a summary of this, not a substitute for it.
   *
   * Every counter is nullable and carries its own provenance, which is what
   * CreatorCore does too: on its report one post shows views and comments and no
   * likes, because likes is what it does not have for that post.
   */
  posts: SharedPostRow[];
  /**
   * The TikTok sound behind the campaign, when its song has one tracked. Null
   * means there is nothing to show — no song, or a song with no sound — and the
   * card is simply absent, the way it is on a campaign that promotes no release.
   *
   * `uses` and `videosAdded24h` are nullable for the usual reason: the tracker
   * row exists as soon as somebody tracks the sound, but its counts only exist
   * after a snapshot has been taken. Zero would claim the audio has never been
   * used, which is a measurement we have not made.
   */
  audio: CampaignAudio | null;
};

export type SharedPostRow = {
  id: string;
  platform: string;
  platformPostId: string | null;
  /**
   * Null on a link that hides creators: a platform post URL carries the handle
   * in its path (tiktok.com/@handle/video/...), so keeping the link would have
   * published exactly the name the toggle was set to withhold.
   */
  postUrl: string | null;
  thumbnailUrl: string | null;
  caption: string | null;
  postedAt: string;
  /** Null for a post never synced, which is "unknown", not "never updated". */
  lastSyncedAt: string | null;
  /** Null when the link hides creators, exactly as the leaderboard is withheld. */
  creator: { id: string; name: string; handle: string | null; avatarUrl: string | null } | null;
  views: number;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  downloads: number | null;
  engagementRate: number | null;
  /**
   * Whether the platform has stopped serving this post.
   *
   * A boolean rather than the raw `fetchState`, because the column carries more
   * than the report is entitled to say — ERROR and a null both describe our own
   * sync, not the post, and neither belongs in a brand's payload. False on a
   * link that does not mark removals, so a hidden removal is indistinguishable
   * from a live post in the RSC payload rather than merely unrendered.
   */
  removed: boolean;
};

export type CampaignAudio = {
  title: string;
  artist: string;
  coverUrl: string | null;
  soundUrl: string;
  uses: number | null;
  videosAdded24h: number | null;
  /**
   * Oldest to newest, for the usage curve. Empty until the sound is synced.
   *
   * `velocity` is the percentage change from the reading before it, which is what
   * CreatorCore's Velocity view of this chart plots -- the same series, asked a
   * different question: Usage is how many, Velocity is how fast.
   */
  usageSeries: { date: string; at: string; uses: number; velocity: number }[];
};

/**
 * What a public share link is allowed to carry.
 *
 * Distinct from CampaignPerformance because hiding a field in the component is
 * not hiding it at all: a client component's props are serialized into the RSC
 * payload, so a leaderboard that renders conditionally still ships every
 * creator's name to anyone who reads the HTML. The money fields become nullable
 * so a withheld value is absent rather than zero — a zero here would be
 * indistinguishable from a campaign that genuinely earned nothing.
 */
export type SharedReportData = Omit<CampaignPerformance, "kpis" | "leaderboard"> & {
  kpis: Omit<CampaignPerformance["kpis"], "emv"> & { emv: number | null };
  leaderboard: (Omit<CampaignPerformance["leaderboard"][number], "emv"> & { emv: number | null })[];
};

/**
 * Strips everything the link may not show, on the server, before the data can
 * reach a payload. Platform filtering is not done here — it happens in the
 * query, because the KPI totals have to be computed over the filtered set
 * rather than trimmed after the fact.
 */
export function redactForShare(
  data: CampaignPerformance,
  visibility: {
    showCreators: boolean;
    showEmv: boolean;
    showStatuses?: boolean;
    markRemovedPosts?: boolean;
  }
): SharedReportData {
  return {
    ...data,
    kpis: {
      ...data.kpis,
      emv: visibility.showEmv ? data.kpis.emv : null,
      // "35 posts, 30 live" tells the brand five posts are gone as plainly as a
      // badge would. The tile only exists when the link chooses to flag removals.
      livePosts: visibility.markRemovedPosts === true ? data.kpis.livePosts : null,
    },
    leaderboard: visibility.showCreators
      ? data.leaderboard.map((row) => ({
          ...row,
          emv: visibility.showEmv ? row.emv : null,
          status: visibility.showStatuses ? row.status : null,
        }))
      : [],
    /* The post list survives a hidden-creator link -- the numbers are the point
       of the report -- but the creator is stripped from each row rather than
       merely left unrendered, since props reach the payload either way. The
       thumbnail and caption go with it: both identify the creator as surely as
       the name does. */
    posts: data.posts.map((row) => ({
      ...row,
      ...(visibility.showCreators
        ? null
        : {
            creator: null,
            thumbnailUrl: null,
            caption: null,
            // The URL names the creator in its path, so it goes with them.
            postUrl: null,
          }),
      /* Flattened to false rather than left as-is, because the flag reaches the
         payload whether the component renders it or not. A brand reading the
         HTML of an unmarked link sees the same value on every post. */
      removed: visibility.markRemovedPosts === true && row.removed,
    })),
  };
}

/**
 * The report is read far more often than it changes.
 *
 * Every view used to pay the full computation -- a serverless function talking
 * to a database in Singapore -- and a client reloading the link paid it again
 * for numbers that had not moved. Measured on this campaign: 734ms uncached
 * against 240ms served from cache.
 *
 * The cache is keyed by the campaign's own state rather than invalidated by a
 * call, because revalidateTag does not reach unstable_cache entries in Next
 * 16.2 with cacheComponents off -- verified by injecting a counter change and
 * watching four consecutive views keep serving the old figure, with both
 * "max" and { expire: 0 } as the profile. A key derived from the data cannot
 * have that bug: when the data moves the key moves, and the old entry simply
 * stops being addressed.
 *
 * Deliberately NOT cached: the share token lookup and its isPublic check, which
 * stay live in the page. Revoking a link takes effect on the very next request,
 * not whenever a cache entry happens to expire.
 *
 * The platform filter is part of the key too, because two links on one campaign
 * can show different platforms and their totals legitimately differ.
 */
export async function computeCampaignPerformance(
  campaign: { id: string; orgId: string; budget: number | null; currency: string },
  platforms?: readonly SharePlatform[]
): Promise<CampaignPerformance> {
  const stamp = await campaignReportStamp(campaign.id);
  const platformKey = [...(platforms ?? [])].sort().join(",") || "all";

  const cached = unstable_cache(
    () => computeCampaignPerformanceUncached(campaign, platforms),
    ["campaign-performance", BUILD_KEY, campaign.id, platformKey, stamp],
    /* An entry is unreachable once the stamp moves, so it only has to outlive
       the run of views that share a stamp. Tagged so a deploy or an operator
       can still drop the lot. */
    { tags: [`campaign-performance:${campaign.id}`], revalidate: 3600 }
  );
  try {
    return await cached();
  } catch (err) {
    /* unstable_cache needs Next's incremental cache in the surrounding context.
       Scripts, jest and anything outside a server request have none, and there
       a missing cache is not an error -- just compute. Matching on the message
       is admittedly brittle; if it ever stops matching, the error surfaces to
       the caller exactly as it would have without this branch. */
    if (!(err instanceof Error) || !err.message.includes("incrementalCache missing")) throw err;
    return computeCampaignPerformanceUncached(campaign, platforms);
  }
}

/**
 * A short string that changes exactly when the report would render differently.
 *
 * Everything the report shows derives from three things: which posts exist,
 * when their counters were last written, and the activation statuses beside
 * them. lastSyncedAt is the honest witness for the middle one -- this codebase
 * stamps it only when counters actually came back (see lib/sync/syncPost), so
 * it moves on precisely the syncs that change a number and stays put on the
 * ones that fetched nothing.
 *
 * One round trip, three cheap aggregates, and it replaces having to remember a
 * revalidate call in every route that writes a post.
 */
async function campaignReportStamp(campaignId: string): Promise<string> {
  /* All three Post facts in one pass. Written first as three correlated
     sub-selects, which read 10,330 buffers because each one scanned the table
     separately -- three times what the single posts query it was meant to save
     ever cost. One aggregate reads 3,443 and answers the same question. */
  const [row] = await db.$queryRaw<
    { posts: bigint; synced: Date | null; views: string | null }[]
  >`
    SELECT COUNT(*) AS posts,
           MAX("lastSyncedAt") AS synced,
           /* Text, because SUM over a Float comes back as a JS number that
              loses precision long before the view counts here would. */
           SUM("viewsCount")::text AS views
      FROM "Post" WHERE "campaignId" = ${campaignId}
  `;

  const [act] = await db.$queryRaw<{ activations: Date | null }[]>`
    SELECT MAX("updatedAt") AS activations FROM "Activation"
     WHERE "campaignId" = ${campaignId} AND "deletedAt" IS NULL
  `;

  if (!row) return "empty";
  return [
    String(row.posts),
    row.synced?.getTime() ?? 0,
    act?.activations?.getTime() ?? 0,
    /* Included because an import writes counters without touching
       lastSyncedAt, and a report that ignored that would show the pre-import
       totals until the next real sync happened to move the stamp. */
    row.views ?? "0",
  ].join("-");
}

async function computeCampaignPerformanceUncached(
  campaign: { id: string; orgId: string; budget: number | null; currency: string },
  /**
   * Restricts every number in the report to these platforms. Applied in the
   * query rather than to the result, because the KPI totals, the leaderboard and
   * the platform split all derive from this one read — filtering afterwards
   * would leave the KPIs describing a wider set than the charts below them.
   * Empty or omitted means no restriction.
   */
  platforms?: readonly SharePlatform[]
): Promise<CampaignPerformance> {
  /* One wave, not three. These reads are independent -- the snapshots are
     scoped through the post relation rather than through a list of ids the
     posts query has to return first -- and the database sits in Singapore, so
     each avoided round trip is worth more than the query itself costs. The
     share report paid for three of them in series on every view. */
  const postWhere = {
    campaignId: campaign.id,
    ...(platforms?.length && { platform: { in: platforms as unknown as never } }),
  };

  const [posts, snapshots, activations] = await Promise.all([
    db.post.findMany({
    where: postWhere,
    select: {
      id: true,
      platform: true,
      platformPostId: true,
      postUrl: true,
      thumbnailUrl: true,
      caption: true,
      postedAt: true,
      viewsCount: true,
      likesCount: true,
      commentsCount: true,
      sharesCount: true,
      savesCount: true,
      downloadsCount: true,
      lastSyncedAt: true,
      platformMetrics: true,
      fetchState: true,
      creator: { select: { id: true, name: true, handle: true, avatarUrl: true } },
    },
    }),

    /* The same platform filter as the posts above, not just the campaign: a
       report restricted to Instagram must not draw a views-over-time line that
       includes the TikTok snapshots its own KPIs exclude. */
    db.postMetricSnapshot.findMany({
      where: { post: postWhere },
      select: { postId: true, viewsCount: true, recordedAt: true },
      orderBy: { recordedAt: "asc" },
    }),

    /* Statuses live on Activation, not on the posts, and a creator can hold more
       than one activation on the same campaign (a re-brief, a second deliverable).
       The most recently updated one is the current state, so ordering ascending
       and letting later rows overwrite lands on it. */
    db.activation.findMany({
      where: { campaignId: campaign.id, deletedAt: null },
      select: { creatorId: true, status: true },
      orderBy: { updatedAt: "asc" },
    }),
  ]);

  const statusByCreator = new Map(activations.map((a) => [a.creatorId, a.status]));

  const views = posts.reduce((s, p) => s + (p.viewsCount ?? 0), 0);

  /* Engagement counters default to 0 for posts we never fetched, so summing them
     all would report a measured zero for an imported campaign. Only posts whose
     engagement is actually known contribute, and a campaign with none reports
     null rather than 0. */
  const measured = posts.filter(
    (p) => metricValue(p.likesCount, p.lastSyncedAt) !== null
  );
  const engagements =
    measured.length === 0
      ? null
      : measured.reduce(
          (s, p) =>
            s +
            sumEngagements({
              likes: p.likesCount,
              comments: p.commentsCount,
              shares: p.sharesCount,
              saves: p.savesCount,
            }),
          0
        );

  const measuredViews = measured.reduce((s, p) => s + (p.viewsCount ?? 0), 0);
  const engagementRate =
    engagements !== null && measuredViews > 0
      ? computeEngagementRate({ views: measuredViews, likes: engagements })
      : null;
  const emv = computeCampaignEmv(
    posts.map((p) => ({
      platform: p.platform,
      views: p.viewsCount,
      likes: p.likesCount,
      comments: p.commentsCount,
      shares: p.sharesCount,
      saves: p.savesCount,
    }))
  );

  /* Each counter carries its own provenance. Summing a column across posts that
     never had it fetched would report a measured zero, and these are exactly the
     columns where that happens: TikTok's public payload gives views, likes,
     comments and shares but never saves or downloads, so those two are usually
     unknown while the others are real. */
  const sumWhere = (
    pick: (p: (typeof posts)[number]) => number | null | undefined,
    provenance: (p: (typeof posts)[number]) => number | null,
  ): number | null => {
    const known = posts.filter((p) => provenance(p) !== null);
    return known.length === 0 ? null : known.reduce((sum, p) => sum + (pick(p) ?? 0), 0);
  };
  /* A tile appears only if some post actually reported that counter. Without the
     per-field test an Instagram-only campaign totalled its unreported shares as
     a measured "Total Shares 0". */
  const totalOf = (field: MetricField, pick: (p: (typeof posts)[number]) => number | null | undefined) =>
    sumWhere(pick, (p) => fieldMetricValue(pick(p), p.lastSyncedAt, p.platformMetrics, field));
  /* Saves and downloads have no writer in this repo at all, so only a value
     vouches for them -- see unwrittenMetricValue. */
  const unwritten = (pick: (p: (typeof posts)[number]) => number | null | undefined) =>
    sumWhere(pick, (p) => unwrittenMetricValue(pick(p)));

  /* Every post, or no tile. A count over the reached subset reads as a count over
     all of them -- "17 posts, 16 live" tells a brand a creator deleted one, when
     the truth was that one Instagram fetch had flaked and we simply did not know.
     != null so an absent key reads the same as an explicit null. */
  const reached = posts.filter((p) => p.fetchState != null);
  const livePosts =
    posts.length > 0 && reached.length === posts.length
      ? reached.filter((p) => p.fetchState === "LIVE").length
      : null;

  const kpis = {
    views,
    engagements,
    engagementRate,
    emv,
    posts: posts.length,
    livePosts,
    likes: totalOf("likes", (p) => p.likesCount),
    comments: totalOf("comments", (p) => p.commentsCount),
    shares: totalOf("shares", (p) => p.sharesCount),
    saves: unwritten((p) => p.savesCount),
    downloads: unwritten((p) => p.downloadsCount),
  };

  const platformByPost = new Map(posts.map((p) => [p.id, p.platform]));
  const buckets = new Map<string, Record<SeriesPlatform, number>>();
  const emptyRow = (): Record<SeriesPlatform, number> => ({
    TIKTOK: 0,
    INSTAGRAM: 0,
    YOUTUBE: 0,
  });

  if (snapshots.length > 0) {
    /* A view count is a running total, not a day's takings, so a day is worth
       the latest reading of every post -- not the sum of whichever posts
       happened to be synced that day. Summing only the day's own readings made
       the line fall whenever a sync covered fewer posts than the one before:
       17 posts of 17 one day, 4 the next, and the chart showed the campaign
       losing three quarters of its views overnight.

       So each post's last known reading is carried forward until a newer one
       replaces it. Snapshots arrive oldest first, which is what makes the
       overwrite below land on the latest reading within each day. */
    const latestPerPostDay = new Map<string, number>();
    const days = new Set<string>();
    for (const snap of snapshots) {
      const platform = platformByPost.get(snap.postId);
      if (!platform || !SERIES_PLATFORMS.includes(platform as SeriesPlatform)) continue;
      const day = dateKey(snap.recordedAt);
      days.add(day);
      latestPerPostDay.set(`${snap.postId}|${day}`, snap.viewsCount ?? 0);
    }

    const lastKnown = new Map<string, number>();
    for (const day of Array.from(days).sort()) {
      for (const [composite, viewsCount] of latestPerPostDay) {
        const sep = composite.lastIndexOf("|");
        if (composite.slice(sep + 1) !== day) continue;
        lastKnown.set(composite.slice(0, sep), viewsCount);
      }
      const row = emptyRow();
      for (const [postId, viewsCount] of lastKnown) {
        const platform = platformByPost.get(postId) as SeriesPlatform | undefined;
        if (platform && SERIES_PLATFORMS.includes(platform)) row[platform] += viewsCount;
      }
      buckets.set(day, row);
    }
  } else {
    for (const p of posts) {
      if (!SERIES_PLATFORMS.includes(p.platform as SeriesPlatform)) continue;
      const day = dateKey(p.postedAt);
      if (!buckets.has(day)) buckets.set(day, emptyRow());
      buckets.get(day)![p.platform as SeriesPlatform] += p.viewsCount ?? 0;
    }
  }

  const timeSeries = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, row]) => ({ date, ...row }));

  const platformSplitMap = new Map<string, { views: number; posts: number }>();
  for (const p of posts) {
    const entry = platformSplitMap.get(p.platform) ?? { views: 0, posts: 0 };
    entry.views += p.viewsCount ?? 0;
    entry.posts += 1;
    platformSplitMap.set(p.platform, entry);
  }
  const platformSplit = Array.from(platformSplitMap.entries())
    .map(([platform, v]) => ({ platform, views: v.views, posts: v.posts }))
    .sort((a, b) => b.views - a.views);

  const leaderboardMap = new Map<
    string,
    {
      creatorId: string;
      name: string;
      avatarUrl: string | null;
      posts: number;
      views: number;
      engagements: number | null;
      measuredViews: number;
    }
  >();
  for (const p of posts) {
    const key = p.creator.id;
    const entry =
      leaderboardMap.get(key) ??
      {
        creatorId: p.creator.id,
        name: p.creator.name,
        avatarUrl: p.creator.avatarUrl,
        posts: 0,
        views: 0,
        engagements: null as number | null,
        measuredViews: 0,
      };
    entry.posts += 1;
    entry.views += p.viewsCount ?? 0;
    if (metricValue(p.likesCount, p.lastSyncedAt) !== null) {
      entry.engagements =
        (entry.engagements ?? 0) +
        sumEngagements({
          likes: p.likesCount,
          comments: p.commentsCount,
          shares: p.sharesCount,
          saves: p.savesCount,
        });
      entry.measuredViews += p.viewsCount ?? 0;
    }
    leaderboardMap.set(key, entry);
  }
  const leaderboard = Array.from(leaderboardMap.values())
    .map(({ measuredViews, ...c }) => ({
      ...c,
      engagementRate:
        c.engagements !== null && measuredViews > 0
          ? computeEngagementRate({ views: measuredViews, likes: c.engagements })
          : null,
      emv: computeCampaignEmv(
        posts
          .filter((p) => p.creator.id === c.creatorId)
          .map((p) => ({
            platform: p.platform,
            views: p.viewsCount,
            likes: p.likesCount,
            comments: p.commentsCount,
            shares: p.sharesCount,
            saves: p.savesCount,
          }))
      ),
      status: statusByCreator.get(c.creatorId) ?? null,
    }))
    .sort((a, b) => b.views - a.views)
    .slice(0, 10);

  /* Sorted by views, matching CreatorCore's own order, so the post a brand cares
     about is the first one it reads. */
  const postRows: SharedPostRow[] = posts
    .slice()
    .sort((a, b) => (b.viewsCount ?? 0) - (a.viewsCount ?? 0))
    .map((p) => {
      /* Per field, not per row: Instagram reports no shares at all, so a shares
         row on an Instagram post would be a zero we invented. */
      const at = (field: MetricField, value: number | null) =>
        fieldMetricValue(value, p.lastSyncedAt, p.platformMetrics, field);
      const likes = at("likes", p.likesCount);
      const comments = at("comments", p.commentsCount);
      const views = p.viewsCount ?? 0;
      const engagements =
        likes === null && comments === null
          ? null
          : sumEngagements({
              likes: p.likesCount,
              comments: p.commentsCount,
              shares: p.sharesCount,
              saves: p.savesCount,
            });
      return {
        id: p.id,
        platform: p.platform,
        platformPostId: p.platformPostId,
        postUrl: p.postUrl,
        thumbnailUrl: p.thumbnailUrl,
        caption: p.caption,
        postedAt: p.postedAt.toISOString(),
        lastSyncedAt: p.lastSyncedAt ? p.lastSyncedAt.toISOString() : null,
        creator: {
          id: p.creator.id,
          name: p.creator.name,
          handle: p.creator.handle,
          avatarUrl: p.creator.avatarUrl,
        },
        views,
        likes,
        comments,
        shares: at("shares", p.sharesCount),
        // Nothing in this repo writes these two -- see unwrittenMetricValue.
        saves: unwrittenMetricValue(p.savesCount),
        downloads: unwrittenMetricValue(p.downloadsCount),
        engagementRate:
          engagements !== null && views > 0
            ? computeEngagementRate({ views, likes: engagements })
            : null,
        /* Computed for every report and stripped in redactForShare, not the
           other way round: the dashboard reads this same shape, and a flag that
           only exists on marked links would be missing where it is always
           wanted. The counters above are untouched either way -- a removed post
           keeps the views it earned. */
        removed: isPostRemoved({ fetchState: p.fetchState, platformMetrics: p.platformMetrics }),
      };
    });

  return {
    currency: campaign.currency,
    kpis,
    timeSeries,
    platformSplit,
    leaderboard,
    posts: postRows,
    audio: await loadCampaignAudio(campaign.id),
  };
}

/**
 * The audio card's data, reached campaign → song → sound.
 *
 * Two reads rather than one nested include: the snapshots are ordered and
 * bounded independently of the song lookup, and most campaigns have no song at
 * all, so the second query usually never runs.
 */
async function loadCampaignAudio(campaignId: string): Promise<CampaignAudio | null> {
  const campaign = await db.campaign.findUnique({
    where: { id: campaignId },
    select: {
      song: {
        select: {
          coverUrl: true,
          sound: { select: { id: true, tiktokSoundId: true, title: true, artist: true, coverImageUrl: true } },
        },
      },
    },
  });
  const sound = campaign?.song?.sound;
  if (!sound) return null;

  /* Newest first here so `take` keeps the most recent window, then reversed for
     the chart, which reads left to right. */
  const snaps = await db.soundTrackerSnapshot.findMany({
    where: { soundId: sound.id },
    select: { usesCount: true, videosAdded24h: true, velocityScore: true, recordedAt: true },
    orderBy: { recordedAt: "desc" },
    take: 60,
  });
  const latest = snaps[0] ?? null;

  return {
    title: sound.title,
    artist: sound.artist,
    // The tracker's own cover wins; the song's art is the fallback for a sound
    // that has been tracked but not yet synced, which is when it has no cover.
    coverUrl: sound.coverImageUrl ?? campaign?.song?.coverUrl ?? null,
    soundUrl: `https://www.tiktok.com/music/x-${sound.tiktokSoundId}`,
    uses: latest ? latest.usesCount : null,
    // A change needs two readings. With one snapshot the stored 0 is the absence
    // of a baseline, not an observation of no growth, so the card shows a dash.
    videosAdded24h: snaps.length >= 2 ? latest!.videosAdded24h : null,
    usageSeries: snaps
      .slice()
      .reverse()
      .map((s) => ({
        date: s.recordedAt.toISOString().slice(0, 10),
        // Several readings can land on one day -- a sync run taken four times
        // in an hour -- and then every point on the axis carried the same date.
        // The card needs the time to tell them apart.
        at: s.recordedAt.toISOString(),
        uses: s.usesCount,
        velocity: s.velocityScore,
      })),
  };
}
