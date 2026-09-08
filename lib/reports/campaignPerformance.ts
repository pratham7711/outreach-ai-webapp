import { unstable_cache } from "next/cache";
import { db } from "@/lib/db";
import {
  computeCampaignEmv,
  computeEngagementRate,
  sumEngagements,
} from "@/lib/metrics";
import { unwrittenMetricValue, fieldMetricValue, rollupEngagement } from "@/lib/metricDisplay";
import type { MetricField } from "@/lib/metricDisplay";
import { isPostRemoved } from "@/lib/postRemoval";
import { carryForwardViewsByDay } from "@/lib/analytics/viewsSeries";
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

/** Only a fallback now: the series takes its groups from the campaign's own
 *  posts, and these are what an empty campaign charts. */
const SERIES_PLATFORMS = ["TIKTOK", "INSTAGRAM", "YOUTUBE"] as const;

/**
 * Ceiling on the views-over-time read, after the database has collapsed it to
 * one row per post per day. The report itself charts every row it is given --
 * there is no from/to on this seam -- so this is the bound, not a calendar
 * window: exceed it and the chart starts later rather than reading unbounded.
 */
const SERIES_SNAPSHOT_ROW_CAP = 100_000;

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
  /**
   * Views over time, one key per platform the campaign actually posted on.
   *
   * Not a fixed TIKTOK/INSTAGRAM/YOUTUBE triple any more. The pie beside this
   * chart splits ALL posts by platform while the chart only ever charted three,
   * so a campaign with a Twitter or Facebook post drew a stacked area whose
   * total sat below the Total Views tile directly above it — the two answered
   * the same question with different denominators. The platforms are named in
   * `seriesPlatforms`; a platform with no colour of its own falls back to a
   * generic series token (see platformColor).
   */
  timeSeries: ({ date: string } & { [platform: string]: number | string })[];
  /** The keys in `timeSeries`, in the order the chart should stack them. */
  seriesPlatforms: string[];
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
   *
   * It is NULL on a sound's very first reading. recordSoundSnapshot stores a 0
   * there because there is no earlier reading to divide by, and that 0 is the
   * absence of a baseline rather than an observation of no growth -- charted, it
   * drew a real "0.00%" point and pulled the line down to it. The tracker's own
   * VelocityChart has always dropped its first point for the same reason.
   */
  usageSeries: { date: string; at: string; uses: number; velocity: number | null }[];
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
 * can show different platforms and their totals legitimately differ. So is the
 * currency: it is carried straight through onto the report and is not part of
 * the stamp (which only watches posts), so switching a campaign from USD to INR
 * used to keep serving the old symbol for up to an hour.
 */
export async function computeCampaignPerformance(
  campaign: { id: string; orgId: string; budget: number | null; currency: string },
  platforms?: readonly SharePlatform[]
): Promise<CampaignPerformance> {
  const stamp = await campaignReportStamp(campaign.id);
  const platformKey = [...(platforms ?? [])].sort().join(",") || "all";

  const cached = unstable_cache(
    () => computeCampaignPerformanceUncached(campaign, platforms),
    ["campaign-performance", BUILD_KEY, campaign.id, campaign.currency, platformKey, stamp],
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

  /* Only the CALLER's filter narrows this now. It used to also narrow to
     SERIES_PLATFORMS, because the chart had three fixed columns and a Twitter
     post's snapshots were fetched and then dropped — but the chart takes its
     columns from the campaign now, so dropping them here would put the hole
     back one layer down. The Post join already bounds this to one campaign.
     Values are bound, never interpolated: $1 is the campaign, the platforms
     take $2 onward. */
  const snapshotParams: unknown[] = [campaign.id];
  const platformFilter = platforms?.length
    ? ` AND p.platform::text IN (${platforms
        .map((p) => {
          snapshotParams.push(p);
          return `$${snapshotParams.length}`;
        })
        .join(", ")})`
    : "";

  const [posts, snapshotDays, activations] = await Promise.all([
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

    /* Collapsed in the database to the rows the chart can actually use: ONE per
       post per UTC day, the latest of that day.

       This was an unbounded findMany over every snapshot the campaign ever
       wrote, and PostMetricSnapshot is an append-only log -- an hourly-synced
       post writes 24 rows a day. carryForwardViewsByDay then throws 23 of them
       away, because a day's value is that day's LAST reading. So the report
       read up to 24x the rows it charts, with no `take` at all: 500 posts
       synced hourly for a year is 4.4M rows crossing the wire to draw 365
       points. DISTINCT ON does the discarding in Postgres, where it is an index
       walk rather than a network transfer, and the result is byte-identical
       because the helper's rule and the ORDER BY are the same rule.

       The day arrives as TEXT, not as a timestamp. PostMetricSnapshot.recordedAt
       is `timestamp without time zone` holding UTC, and node-postgres reads that
       as LOCAL time -- correct on Vercel, 5h30m out on an IST laptop, which
       would move readings near midnight into the wrong day. to_char formats it
       in the database, where the value is unambiguous. One row per post per day
       also means there is nothing left to tie-break, so a midnight-UTC Date
       rebuilt from that string carries all the information the helper needs. */
    db.$queryRawUnsafe<{ postId: string; day: string; viewsCount: number | null }[]>(
      `SELECT * FROM (
         SELECT DISTINCT ON (s."postId", s."recordedAt"::date)
                s."postId"                            AS "postId",
                to_char(s."recordedAt", 'YYYY-MM-DD') AS "day",
                s."viewsCount"                        AS "viewsCount"
           FROM "PostMetricSnapshot" s
           JOIN "Post" p ON p.id = s."postId"
          WHERE p."campaignId" = $1${platformFilter}
          ORDER BY s."postId", s."recordedAt"::date, s."recordedAt" DESC, s.id DESC
       ) collapsed
       /* A hard bound, so no single campaign can ever read the whole table.
          Newest first, so a campaign large enough to hit it loses the LEFT edge
          of its chart rather than its current numbers. At one row per post per
          day this is 500 posts charted for 200 days. */
       ORDER BY collapsed."day" DESC
       LIMIT ${SERIES_SNAPSHOT_ROW_CAP}`,
      ...snapshotParams
    ),

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
     null rather than 0. rollupEngagement is that rule, and it is the product's
     single definition of the rate -- the campaign Overview tile and the Posts
     tab now read the same function, so the three screens can no longer print
     three different engagement rates for one campaign. */
  const { engagements, rate: engagementRate } = rollupEngagement(posts);
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

  /* One carry-forward, snapshots or not. The two branches this replaced treated
     an unsnapshotted post two ways -- charted from its posting day when NO post
     had snapshots, dropped from the chart entirely when some other post did --
     so a campaign where half the posts were synced drew a line below its own
     Total Views tile. lib/analytics/viewsSeries carries the rule, and
     /api/analytics/campaigns now reads the same function. */
  /* Every platform this campaign posted on, most-viewed first, so the stacked
     total matches the Total Views tile and the legend reads in the same order
     as the pie. SERIES_PLATFORMS is the fallback for a campaign with no posts
     at all — an empty group list would draw nothing to say "nothing". */
  const platformViews = new Map<string, number>();
  for (const p of posts) {
    platformViews.set(p.platform, (platformViews.get(p.platform) ?? 0) + (p.viewsCount ?? 0));
  }
  const seriesPlatforms: string[] =
    platformViews.size > 0
      ? Array.from(platformViews.entries())
          .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
          .map(([platform]) => platform)
      : [...SERIES_PLATFORMS];

  const timeSeries = carryForwardViewsByDay({
    posts: posts.map((p) => ({
        id: p.id,
        group: p.platform as string,
        postedAt: p.postedAt,
        viewsCount: p.viewsCount,
      })),
    /* Midnight UTC of the day the database collapsed the reading into. dayKey()
       reads it straight back out, and there is exactly one row per post per
       day, so nothing downstream needs the original clock time. */
    snapshots: snapshotDays.map((s) => ({
      postId: s.postId,
      recordedAt: new Date(`${s.day}T00:00:00.000Z`),
      viewsCount: s.viewsCount,
    })),
    groups: seriesPlatforms,
  }).map(({ date, totals }) => ({ date, ...totals }));

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

  /* Grouped first, rated afterwards by the same rollupEngagement the KPI tile
     uses. Accumulating the numerator and denominator inline here was a second
     copy of the definition sitting twenty lines below the first. */
  const postsByCreator = new Map<string, typeof posts>();
  for (const p of posts) {
    const bucket = postsByCreator.get(p.creator.id);
    if (bucket) bucket.push(p);
    else postsByCreator.set(p.creator.id, [p]);
  }
  const leaderboard = Array.from(postsByCreator.values())
    .map((creatorPosts) => {
      const creator = creatorPosts[0].creator;
      const { engagements: creatorEngagements, rate } = rollupEngagement(creatorPosts);
      return {
        creatorId: creator.id,
        name: creator.name,
        avatarUrl: creator.avatarUrl,
        posts: creatorPosts.length,
        views: creatorPosts.reduce((s, p) => s + (p.viewsCount ?? 0), 0),
        engagements: creatorEngagements,
        engagementRate: rate,
        emv: computeCampaignEmv(
          creatorPosts.map((p) => ({
            platform: p.platform,
            views: p.viewsCount,
            likes: p.likesCount,
            comments: p.commentsCount,
            shares: p.sharesCount,
            saves: p.savesCount,
          }))
        ),
        status: statusByCreator.get(creator.id) ?? null,
      };
    })
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
    seriesPlatforms,
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
  const SERIES_POINTS = 60;
  /* One past the window, purely to answer "is the oldest point we are about to
     chart this sound's FIRST reading?". If a 61st exists, the oldest charted
     point has a predecessor and its stored velocity is a real measurement. */
  const rows = await db.soundTrackerSnapshot.findMany({
    where: { soundId: sound.id },
    select: { usesCount: true, videosAdded24h: true, velocityScore: true, recordedAt: true },
    orderBy: { recordedAt: "desc" },
    take: SERIES_POINTS + 1,
  });
  const hasEarlier = rows.length > SERIES_POINTS;
  const snaps = rows.slice(0, SERIES_POINTS);
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
      .map((s, i) => ({
        date: s.recordedAt.toISOString().slice(0, 10),
        // Several readings can land on one day -- a sync run taken four times
        // in an hour -- and then every point on the axis carried the same date.
        // The card needs the time to tell them apart.
        at: s.recordedAt.toISOString(),
        uses: s.usesCount,
        // The stored 0 on a sound's first-ever reading is a placeholder, not a
        // measurement. Null so the velocity chart starts at the second point.
        velocity: i === 0 && !hasEarlier ? null : s.velocityScore,
      })),
  };
}
