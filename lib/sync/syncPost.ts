import type { SandboxPostFetcher } from "@/lib/platforms/tiktokPostSandbox";
import { db } from "@/lib/db";
import { LAST_FETCH_KEY, MEASURED_FIELDS_KEY, type MetricField } from "@/lib/metricDisplay";
import {
  fetchPostMetrics,
  hasMetricCounts,
  type FetchReason,
  type PostMetrics,
} from "@/lib/platforms/fetchPostMetrics";
import { getInstagramAccountForCreator } from "@/lib/platforms/instagramToken";
import { getTikTokTokenForCreator } from "@/lib/platforms/tiktokToken";

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
  thumbnailUrl: string | null;
  caption: string | null;
  /** Read to merge into rather than clobber -- the importer's raw record lives here. */
  platformMetrics?: unknown;
};

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
export function countsFrom(metrics: PostMetrics): {
  counts: Record<string, number>;
  present: MetricField[];
  measuredPatch: Record<string, MetricField[]>;
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
  return { counts, present, measuredPatch: { [MEASURED_FIELDS_KEY]: present } };
}

/* The importer's raw record also lives in this bag, so it is always merged and
   never replaced. */
function currentBag(post: SyncablePost): Record<string, unknown> {
  return typeof post.platformMetrics === "object" && post.platformMetrics !== null
    ? (post.platformMetrics as Record<string, unknown>)
    : {};
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
    const reason = metrics.fetchReason ?? "unknown";
    // Worth keeping if the fetch produced one: a thumbnail with no counts is
    // still better than an empty card. No lastSyncedAt -- see above.
    const updated = await db.post.update({
      where: { id: post.id },
      data: {
        thumbnailUrl: metrics.thumbnailUrl ?? post.thumbnailUrl,
        caption: metrics.caption ?? post.caption,
        /* The cause, on the post, in the write this branch already made.
           Costs no extra query and is the only record that survives the run:
           the aggregate on CampaignRefreshRun says 21 posts went unmeasured
           but never which, and the platform log lines age out. */
        platformMetrics: {
          ...currentBag(post),
          [LAST_FETCH_KEY]: { reason, at: new Date().toISOString(), via: syncSource },
        },
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

  const { counts, present } = countsFrom(metrics);

  const views = metrics.viewsCount ?? 0;
  const likes = metrics.likesCount ?? 0;
  const comments = metrics.commentsCount ?? 0;
  const shares = metrics.sharesCount ?? 0;
  const saves = metrics.savesCount ?? 0;
  const engagementRate =
    metrics.engagementRate ?? (views > 0 ? ((likes + comments) / views) * 100 : 0);

  /* The same payload told us how many followers the author has, and nothing in
     this codebase had ever written that column -- so the campaign roster showed
     0 followers for all 25 creators while the number sat in a response we had
     already fetched. Only ever upward from nothing, and only a real figure: a
     platform that did not report it must not overwrite one that did. */
  const followers = metrics.authorFollowers;
  const creatorUpdate =
    typeof followers === "number" && followers > 0
      ? [
          db.creator.update({
            where: { id: post.creatorId },
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
        lastSyncedAt: new Date(),
        ...counts,
        engagementRate,
        /* Merged, not replaced: this bag also holds the importer's raw record. */
        platformMetrics: {
          ...currentBag(post),
          [MEASURED_FIELDS_KEY]: present,
          /* Cleared, not left behind. A post that reads fine today must not keep
             advertising why it failed last week -- a stale cause is worse than
             none, because it invites someone to go and fix a live post. */
          [LAST_FETCH_KEY]: null,
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
        engagementRate,
        syncSource,
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
      ? await getInstagramAccountForCreator(post.creatorId, orgId)
      : undefined;
  const tiktokToken =
    post.platform === "TIKTOK" ? await getTikTokTokenForCreator(post.creatorId, orgId) : undefined;

  const metrics = await fetchPostMetrics(post.postUrl, {
    instagramToken: instagram?.token,
    instagramHandle: instagram?.handle,
    tiktokToken,
    countsOnly: options.countsOnly,
    tiktokSandbox: options.tiktokSandbox,
  });
  if (!metrics) return { status: "unfetchable", reason: "unrecognised-url" };

  return applyPostMetrics(post, metrics);
}
