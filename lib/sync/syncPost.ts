import type { SandboxPostFetcher } from "@/lib/platforms/tiktokPostSandbox";
import { db } from "@/lib/db";
import { LAST_FETCH_KEY, MEASURED_FIELDS_KEY, lastFetchNote, nextLastFetchNote, type MetricField } from "@/lib/metricDisplay";
import {
  fetchPostMetrics,
  hasMetricCounts,
  type FetchReason,
  type PostMetrics,
} from "@/lib/platforms/fetchPostMetrics";
import { followerLadder, keepPrecise, postLadder, roundedStep } from "@/lib/platforms/precision";
import { getInstagramAccountForCreator } from "@/lib/platforms/instagramToken";
import { getTikTokTokenForCreator } from "@/lib/platforms/tiktokToken";
import { METRIC_WRITERS_KEY, rankPostCounters, type WriterNotes } from "@/lib/metrics/postWriters";
import { protectedCreatorFollowers } from "@/lib/creators/followerWriter";
import { UNATTRIBUTED_CREATOR_WHERE } from "@/lib/posts/unattributedCreator";
import { countsContradict, engagementExceedsViews } from "@/lib/metrics/coherence";

/**
 * Refresh one post's metrics from its platform.
 *
 * Lives here rather than in the route because two callers drive it: the per-post
 * "Sync Now" button and the campaign-wide Refresh, which loops it. The cron in
 * app/api/cron/sync-posts keeps its own SCHEDULING -- it batches YouTube ids,
 * spends per-platform budgets and applies backoff, none of which an on-demand
 * refresh wants -- but it no longer keeps its own WRITE. It calls
 * applyPostMetrics below.
 *
 * That distinction was not academic. Its private copy stamped
 * `{ lastSyncedAt: now, syncFailCount: 0 }` on every post it fetched, including
 * the ones that came back with no counts -- so once an hour, in production, it
 * converted unknowns into measured zeros and reset the fail counters that let a
 * dead post dead-letter. Any fix to the refresh path was undone within the
 * hour. Two copies of a rule this load-bearing is one copy too many.
 *
 * The rule that matters: lastSyncedAt is stamped only when counts actually came
 * back. Every counter is a non-nullable Float defaulting to 0, so lastSyncedAt
 * is the only thing separating "this post got no likes" from "nobody has
 * looked" (see lib/metricDisplay). Stamping it on a fetch that returned nothing
 * -- which is what every TikTok fetch does from a network where TikTok is
 * blocked -- silently converts a screenful of unknowns into measured zeros, and
 * no later sync can tell them apart again.
 */

export const SYNC_POST_INCLUDE = {
  creator: { select: { id: true, name: true, handle: true, avatarUrl: true } },
  snapshots: { orderBy: { recordedAt: "desc" as const }, take: 50 },
};

export type SyncPostOutcome =
  /** Counts came back and were written, with a snapshot for the timeseries. */
  | { status: "measured"; post: Record<string, unknown> }
  /** The platform answered but carried no counts; only media/caption touched. */
  | { status: "no-metrics"; post: Record<string, unknown>; reason: FetchReason }
  /** Nothing usable at all -- an unrecognised URL, or the platform unreachable. */
  | { status: "unfetchable"; reason: FetchReason };

type SyncablePost = {
  id: string;
  platform: string;
  creatorId: string;
  postUrl: string;
  /** Read for Facebook only, where it is the Graph id once the post was found. */
  platformPostId?: string;
  thumbnailUrl: string | null;
  caption: string | null;
  /** Read to merge into rather than clobber -- the importer's raw record lives here. */
  platformMetrics?: unknown;
  /* The counters already on the row, where the caller selected them. Read only
     to refuse a lossy overwrite -- see withStoredPrecision. Optional in the same
     spirit as platformMetrics above: absent means the caller did not ask for
     them, which is not the same as zero, and the guard simply does not apply. */
  viewsCount?: number;
  likesCount?: number;
  commentsCount?: number;
  sharesCount?: number;
  savesCount?: number;
  reachCount?: number;
};

/**
 * A rounded read must not destroy an exact figure we already hold.
 *
 * TikTok's page serves counters at display precision above 10,000 -- 11.1K,
 * 563.3K, 15.5M -- while the CreatorCore import carries the platform's exact
 * ones. Measured 2026-09-15: 29 posts had exact imported figures replaced by
 * rounded page reads, and every hourly cron pass did it again, so a number that
 * was right became permanently wrong and no later sync could tell.
 *
 * Re-exported from ./precision rather than defined here: the same rule now
 * guards three columns on three different write paths, and each platform rounds
 * on its own ladder. Callers inside this module pass postLadder(post.platform),
 * so an Instagram or YouTube post -- both of which publish their real digits --
 * takes the exact ladder and the guard never fires.
 */
export { keepPrecise };

/** The same, across every counter, returning the original object when it changed nothing. */
export function withStoredPrecision(metrics: PostMetrics, post: SyncablePost): PostMetrics {
  const ladder = postLadder(post.platform);
  const pairs: [keyof PostMetrics, number | undefined][] = [
    ["viewsCount", post.viewsCount],
    ["likesCount", post.likesCount],
    ["commentsCount", post.commentsCount],
    ["sharesCount", post.sharesCount],
    ["savesCount", post.savesCount],
  ];

  let out: PostMetrics | null = null;
  for (const [key, stored] of pairs) {
    const incoming = metrics[key] as number | undefined;
    const kept = keepPrecise(incoming, stored, ladder);
    if (kept === incoming) continue;
    out = out ?? { ...metrics };
    (out as Record<string, unknown>)[key] = kept;
  }
  return out ?? metrics;
}

/**
 * The counters a fetch actually delivered, and their column values.
 *
 * Which counters come back varies by platform and by post: TikTok's public
 * payload carries views, likes, comments and shares; Instagram's carries views
 * and comments, likes only sometimes, and shares never. Coercing the absent ones
 * with `?? 0` and then stamping lastSyncedAt is what made three Instagram posts
 * report "0 likes, 0 shares" on a report where CreatorCore, reading the same
 * three posts, shows neither row.
 *
 * An absent field is left out of the write entirely, so whatever was there
 * before -- an imported figure, or the untouched default -- survives, and the
 * list of what was present is stored for the display to read back. Shared with
 * the create route in app/api/campaigns/[id]/posts, which builds a new row from
 * the same fetch and had the same `?? 0`.
 *
 * See fieldMetricValue in lib/metricDisplay for the other half.
 */
export function countsFrom(
  metrics: PostMetrics,
  now: Date = new Date(),
): {
  counts: Record<string, number>;
  present: MetricField[];
  measuredPatch: Record<string, MetricField[] | WriterNotes>;
} {
  const present: MetricField[] = [];
  const counts: Record<string, number> = {};
  const record = (field: MetricField, column: string, value: number | undefined) => {
    if (typeof value !== "number") return;
    present.push(field);
    counts[column] = value;
  };
  record("views", "viewsCount", metrics.viewsCount);
  record("likes", "likesCount", metrics.likesCount);
  record("comments", "commentsCount", metrics.commentsCount);
  record("shares", "sharesCount", metrics.sharesCount);
  record("saves", "savesCount", metrics.savesCount);
  record("reach", "reachCount", metrics.reachCount);
  /* A new post's first reading is signed the way applyPostMetrics signs every
     later one, so a connected read taken when the post was added is protected
     from the next public sync like any other (plan A7). */
  const writers = rankPostCounters(metrics, {}, null, now).notes;
  return { counts, present, measuredPatch: { [MEASURED_FIELDS_KEY]: present, [METRIC_WRITERS_KEY]: writers } };
}

/* The importer's raw record also lives in this bag, so it is always merged and
   never replaced.
   
   Returns null -- meaning "do not write this column at all" -- when the caller
   did not select platformMetrics. Prisma leaves the property absent in that
   case and reports it as null when the column is genuinely empty, so the two
   are distinguishable, and the difference matters: merging into `{}` because
   the field was never loaded would REPLACE the bag, silently discarding
   __measured and the importer's ccRaw record. Two of the five callers here
   read the post with `findFirst` and no select, which happens to return every
   scalar; the type has always allowed one that does not.
   
   Losing the diagnostic on such a caller is acceptable. Erasing a post's
   measured-field list to record why a fetch failed is not. */
function currentBag(post: SyncablePost): Record<string, unknown> | null {
  if (post.platformMetrics === undefined) return null;
  return typeof post.platformMetrics === "object" && post.platformMetrics !== null
    ? (post.platformMetrics as Record<string, unknown>)
    : {};
}

/** The countless write: keep the post's numbers, record why this read added none. */
async function recordUnread(
  post: SyncablePost,
  metrics: PostMetrics,
  reason: FetchReason,
  syncSource: string,
): Promise<SyncPostOutcome> {
  const noMetricsBag = currentBag(post);
  // Worth keeping if the fetch produced one: a thumbnail with no counts is
  // still better than an empty card. No lastSyncedAt -- see above.
  const updated = await db.post.update({
    where: { id: post.id },
    data: {
      thumbnailUrl: metrics.thumbnailUrl ?? post.thumbnailUrl,
      caption: metrics.caption ?? post.caption,
      /* UNAVAILABLE on exactly two reasons, and never on the others.
         "post-deleted" and "post-hidden" are the platform stating positively
         that the public cannot see the post; every other failure here is us
         failing to read it, and the
         measured branch below explains at length why writing UNAVAILABLE on
         those would tell a brand its creators had pulled the campaign.

         No ERROR state is written. It would need to mean "persistently
         unreadable", and there is no longer a counter for that: the reasons
         that used to accumulate toward one are precisely the reasons the cron
         now refuses to charge. The honest per-post record of a failed read is
         __lastFetch, written just below. */
      ...(reason === "post-deleted" || reason === "post-hidden" ? { fetchState: "UNAVAILABLE" as const } : {}),
      /* The cause, on the post, in the write this branch already made.
         Costs no extra query and is the only record that survives the run:
         the aggregate on CampaignRefreshRun says 21 posts went unmeasured
         but never which, and the platform log lines age out.

         It also carries the streak (since, strikes) from the note already
         there, because "deleted" needs two checks that agree (plan A5) and
         the previous note is the only memory of the first one. */
      ...(noMetricsBag
        ? {
            platformMetrics: {
              ...noMetricsBag,
              [LAST_FETCH_KEY]: nextLastFetchNote(
                lastFetchNote(noMetricsBag),
                reason,
                new Date().toISOString(),
                syncSource,
              ),
            },
          }
        : {}),
    },
    include: SYNC_POST_INCLUDE,
  });
  /* Why, not just that. A caller counting these can now say "62 challenged by
     TikTok, 4 deleted" instead of "66 returned no metrics", which is the
     difference between a report someone can act on and one they cannot. */
  return {
    status: "no-metrics",
    post: updated as unknown as Record<string, unknown>,
    /* "unknown", not "no-counts-published". A fetcher that named no reason
       has told us nothing about the post, and the old default turned that
       silence into the claim that the post publishes no counters -- which
       refreshCampaign treats as settled and never retries. */
    reason,
  };
}

/**
 * Write metrics that were already fetched.
 *
 * Split out from syncPost because fetching and writing sometimes cannot happen
 * on the same network. TikTok is unreachable from India and our database is
 * unreachable through the VPN that fixes that -- port 5432 gets reset while 443
 * passes -- so the dev filler fetches with the tunnel up and writes with it
 * down. Both paths land here, so the offline writer cannot drift from the live
 * one on which columns it sets.
 */
export async function applyPostMetrics(
  post: SyncablePost,
  metrics: PostMetrics,
  /* Stamped on the snapshot only. /settings/ingestion groups snapshots by this
     and the post detail page shows it as a badge, so a caller sharing this
     writer must still be able to sign its own work -- otherwise adopting it
     would relabel every cron snapshot as "api" and lose the provenance. */
  options: { syncSource?: string } = {},
): Promise<SyncPostOutcome> {
  const syncSource = options.syncSource ?? "api";
  if (!hasMetricCounts(metrics)) {
    /* Named before the fetcher's own reason: a reading refused for
       contradicting itself carried numbers, so whatever the fetcher said about
       an empty answer does not describe it. Filed as "unknown" until
       2026-10-03, which charged it and switched four live posts off. */
    return recordUnread(post, metrics, countsContradict(metrics) ? "counts-inconsistent" : metrics.fetchReason ?? "unknown", syncSource);
  }

  /* Before anything reads a counter: a display-rounded figure never replaces a
     more precise stored one. See withStoredPrecision. Then the source order
     (plan A7): a counter the creator's own connection wrote within its
     freshness window is not replaced by a public reading, and keeps its stored
     value through the rest of this write -- the post, the snapshot and the
     rate. See rankPostCounters. */
  const now = new Date();
  const ranked = rankPostCounters(withStoredPrecision(metrics, post), post, post.platformMetrics, now);
  const measured = ranked.metrics;
  /* A lifetime view count does not fall to zero. A reading that says it did
     is a bad read, not a fact about the post: on 2026-09-19 a TikTok post read
     53,700 views at 13:35 and a measured 0 at 14:43, and that 0 has stood on
     the post ever since. The coherence check below catches such a reading only
     while some other counter is still above zero; an all-zero one passed. */
  if (measured.viewsCount === 0 && (post.viewsCount ?? 0) > 0) {
    return recordUnread(post, metrics, "counts-inconsistent", syncSource);
  }
  const { counts, present } = countsFrom(measured);

  /* What the post holds once this write lands, counter by counter: this read's
     figure where it measured one, otherwise the figure already on the row --
     which is exactly what the present-only post write below leaves there. The
     snapshot records that, not `?? 0`. A partial read (an Instagram embed
     answering with comments while Graph timed out) used to land in the history
     as zero views, and every chart built on snapshots -- the client report's
     views over time, the post's velocity, the bot signals -- dropped the post's
     whole audience for that day: 26 such rows on prod by 2026-10-03. */
  const known = (field: MetricField) => present.includes(field) || ranked.held.includes(field);
  const after = (value: number | undefined, stored: number | undefined) => value ?? stored ?? 0;
  const views = after(measured.viewsCount, post.viewsCount);
  const likes = after(measured.likesCount, post.likesCount);
  const comments = after(measured.commentsCount, post.commentsCount);
  const shares = after(measured.sharesCount, post.sharesCount);
  const saves = after(measured.savesCount, post.savesCount);
  /* Only from counters somebody measured. Coercing an absent views or likes to
     0 wrote a 0% rate onto a post whose read simply did not carry them, and
     that 0 then reached the creator page and the dashboard as a real rate.
     Undefined leaves the stored rate as it was. */
  const viewsKnown = known("views") || (post.viewsCount ?? 0) > 0;
  const likesKnown = known("likes") || (post.likesCount ?? 0) > 0;
  /* The row this write would leave, not just the reading. A read carrying
     views alone (an embed, or a held connected counter beside a public one)
     can be consistent on its own and still land under a stored likes count
     from another source -- one post on prod held 1,406 views under 5,083
     likes that way on 2026-09-30. Which side is wrong cannot be told from
     here, so the post keeps what it had. See lib/metrics/coherence. */
  if (viewsKnown && engagementExceedsViews(views, { likes, comments, shares, saves })) {
    return recordUnread(post, metrics, "counts-inconsistent", syncSource);
  }
  const engagementRate =
    measured.engagementRate ??
    (viewsKnown && likesKnown && views > 0 ? ((likes + comments) / views) * 100 : undefined);

  /* The same payload told us how many followers the author has, and nothing in
     this codebase had ever written that column -- so the campaign roster showed
     0 followers for all 25 creators while the number sat in a response we had
     already fetched. Only ever upward from nothing, and only a real figure: a
     platform that did not report it must not overwrite one that did.

     The post payload's author block is the WORST source we have for this column.
     Measured 2026-09-15 on a video page: authorStats and authorStatsV2 both read
     "1600000" while the same account's profile page reported 1,608,098. So the
     write is gated the way the post counters are -- see keepPrecise. A rounded
     figure R only tells us the truth is near R; if the stored value already sits
     in that window it is the same fact at higher precision, and overwriting it
     loses the precision for good. Expressed as a WHERE rather than a read so the
     decision stays inside the one transaction, and updateMany because a where
     that matches nothing is the intended outcome here, not a P2025. */
  const followers = measured.authorFollowers;
  const followerStep = roundedStep(followers, followerLadder(post.platform));
  const writesFollowers = typeof followers === "number" && followers > 0;
  /* Every source of authorFollowers is a public read, so it also yields to
     the creator's own connection (plan A7): while the column holds a connected
     figure the tracker wrote inside its freshness window, the WHERE matches
     nothing. See protectedCreatorFollowers. */
  const keepFollowers = writesFollowers ? await protectedCreatorFollowers(post.creatorId, now) : null;
  const creatorUpdate = writesFollowers
    ? [
        db.creator.updateMany({
          where: {
            id: post.creatorId,
            /* Each post under the Unattributed row has a different author, so
               none of their follower counts is this row's. */
            AND: [{ NOT: UNATTRIBUTED_CREATOR_WHERE }],
            ...(followerStep !== null
              ? {
                  OR: [
                    { followersCount: { lt: followers - followerStep / 2 } },
                    { followersCount: { gte: followers + followerStep } },
                  ],
                }
              : {}),
            ...(keepFollowers !== null ? { NOT: { followersCount: keepFollowers } } : {}),
          },
          data: { followersCount: followers },
        }),
      ]
    : [];

  const [updated] = await db.$transaction([
    db.post.update({
      where: { id: post.id },
      data: {
        thumbnailUrl: metrics.thumbnailUrl ?? post.thumbnailUrl,
        caption: metrics.caption ?? post.caption,
        /* The platform is authoritative about when its own post was published,
           and this never wrote it -- so posts created while their platform was
           unreachable kept the placeholder date the create route had to invent
           for a non-nullable column, even after a later sync learned the real
           one. On the reference campaign that was all seventeen of them. */
        ...(metrics.postedAt ? { postedAt: metrics.postedAt } : {}),
        /* The platform answered with this post's numbers, so the post is up.
           Nothing else in this codebase ever wrote fetchState, so "Live Posts"
           had no source at all despite the column existing.

           Only ever LIVE, never the reverse: a fetch that fails is far more
           often our network than a deleted post -- every TikTok fetch fails from
           here -- and writing UNAVAILABLE on that would tell a brand its
           creators had taken the campaign down. */
        fetchState: "LIVE" as const,
        lastSyncedAt: now,
        ...counts,
        ...(engagementRate !== undefined ? { engagementRate } : {}),
        /* Merged, not replaced: this bag also holds the importer's raw record. */
        platformMetrics: {
          /* `?? {}` only where the bag is written unconditionally: this branch
             must record __measured, which is what tells the UI a zero was
             measured rather than assumed, so skipping the column is not an
             option here. A caller that did not select platformMetrics loses
             whatever else was in the bag either way -- it did before this
             commit too -- and every caller in the tree does select it. */
          ...(currentBag(post) ?? {}),
          /* A held counter the caller did not load is left out of the write,
             but it was measured -- by the source that is still protecting it. */
          [MEASURED_FIELDS_KEY]: ranked.held.length > 0 ? [...present, ...ranked.held] : present,
          /* Cleared, not left behind. A post that reads fine today must not keep
             advertising why it failed last week -- a stale cause is worse than
             none, because it invites someone to go and fix a live post. */
          [LAST_FETCH_KEY]: null,
          /* Which source wrote each counter, and when, for the next write to
             ask. See lib/metrics/postWriters. */
          [METRIC_WRITERS_KEY]: ranked.notes,
        },
      },
      include: SYNC_POST_INCLUDE,
    }),
    db.postMetricSnapshot.create({
      data: {
        postId: post.id,
        viewsCount: views,
        likesCount: likes,
        commentsCount: comments,
        sharesCount: shares,
        savesCount: saves,
        // Non-nullable column; the post page rates each row from its counts.
        engagementRate: engagementRate ?? 0,
        syncSource,
        /* Which of the numbers above were actually measured.
           The post's own columns are protected by countsFrom's present-only
           rule, but every counter here is a non-nullable Float defaulting to 0,
           so the `?? 0` coercions above write a fabricated zero for anything the
           platform did not report. That matters most for a partial read: an
           Instagram post whose Graph call times out but whose embed returns a
           comment count is "measured", and lands in this table claiming zero
           views and zero likes forever.
           Making the columns nullable would need a schema change pushed to a
           production database that has no migration history, so the absence is
           recorded here instead -- same __measured key the post bag uses, so a
           reader can already interpret it. */
        platformMetrics: { [MEASURED_FIELDS_KEY]: present },
      },
    }),
    ...creatorUpdate,
  ]);

  return { status: "measured", post: updated as unknown as Record<string, unknown> };
}

export async function syncPost(
  post: SyncablePost,
  orgId: string,
  options: { countsOnly?: boolean; tiktokSandbox?: SandboxPostFetcher } = {},
): Promise<SyncPostOutcome> {
  const instagram =
    post.platform === "INSTAGRAM"
      ? await getInstagramAccountForCreator(post.creatorId, orgId, post.postUrl)
      : undefined;
  const tiktokToken =
    post.platform === "TIKTOK" ? await getTikTokTokenForCreator(post.creatorId, orgId) : undefined;

  const metrics = await fetchPostMetrics(post.postUrl, {
    instagramToken: instagram?.token,
    instagramHandle: instagram?.handle,
    instagramOrgId: orgId,
    tiktokToken,
    countsOnly: options.countsOnly,
    tiktokSandbox: options.tiktokSandbox,
    ...(post.platform === "FACEBOOK"
      ? { facebook: { orgId, creatorId: post.creatorId, knownPostId: post.platformPostId } }
      : {}),
  });
  if (!metrics) return { status: "unfetchable", reason: "unrecognised-url" };

  /* A Facebook post added before its Page connected is stored under the link's
     own id. The first read that finds it on the Page hands back the Graph id,
     which the comments edge and every later read need. */
  if (
    post.platform === "FACEBOOK" &&
    /^\d+_\d+$/.test(metrics.platformPostId) &&
    metrics.platformPostId !== post.platformPostId
  ) {
    await db.post.update({ where: { id: post.id }, data: { platformPostId: metrics.platformPostId } });
  }

  return applyPostMetrics(post, metrics);
}
