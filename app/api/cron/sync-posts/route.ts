import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import {
  detectPlatform,
  fetchPostMetrics,
  fetchYouTubeMetricsBatch,
  UNCHARGEABLE_REASONS,
  type FetchReason,
  type PostMetrics,
} from "@/lib/platforms/fetchPostMetrics";
import { applyPostMetrics } from "@/lib/sync/syncPost";
import { ensureFreshInstagramToken } from "@/lib/platforms/instagramToken";
import { ensureFreshTikTokToken } from "@/lib/platforms/tiktokToken";
import { decideSyncAction, SyncAction } from "@/lib/sync/cadence";
import { LAST_FETCH_KEY } from "@/lib/metricDisplay";
import { alertOps, shouldAlertOnBatch } from "@/lib/alerts";
import { createLogger } from "@/lib/observability/logger";

const MAX_SYNC_FAILURES = 5;
const DEFAULT_PLATFORM_BUDGET = 100;

/* Campaigns with no interval of their own keep exactly today's behaviour --
   swept every run -- so this filter can never make an existing campaign staler
   than it already is. Only campaigns carrying an explicit interval slow down. */
const DEFAULT_REFRESH_INTERVAL_HOURS = 1;
/* The reference product's off switch, and it arrived in our data with the
   import: Campaign.refreshInterval is populated on every migrated campaign and
   9999 is the value it uses for "do not auto-refresh this". Honouring it is the
   difference between sweeping 506 campaigns an hour and sweeping the handful
   that asked to be swept. */
const REFRESH_OFF_SENTINEL = 9999;

type RefreshCadence = {
  refreshActive: boolean | null;
  refreshInterval: number | null;
  lastRefreshAt: Date | null;
};

export function isCampaignDue(campaign: RefreshCadence, now: Date): boolean {
  if (campaign.refreshActive === false) return false;
  const interval = campaign.refreshInterval ?? DEFAULT_REFRESH_INTERVAL_HOURS;
  if (interval >= REFRESH_OFF_SENTINEL) return false;
  if (!campaign.lastRefreshAt) return true;
  return now.getTime() - campaign.lastRefreshAt.getTime() >= interval * 60 * 60 * 1000;
}

/* Reasons a further attempt cannot change. Both are things a platform states
   positively about the post, so re-asking hourly for five hours before
   dead-lettering only delays the same answer. Everything else -- a WAF
   challenge, a refusal, a shut gate, an unexplained empty -- is about the
   moment or about us, and deserves the retries. */
const SETTLED_REASONS: ReadonlySet<FetchReason> = new Set<FetchReason>([
  "post-deleted",
  "unrecognised-url",
]);

type Decision = { postId: string; platform: string; action: SyncAction; reason: string };

/**
 * When this post was last ASKED about, from the __lastFetch stamp that
 * applyPostMetrics writes on every countless attempt and clears on a measured
 * one. Feeds the cadence throttles so a post that never succeeds is spaced out
 * like any other, instead of being the one post retried on every single run.
 */
function lastAttemptFrom(platformMetrics: unknown): Date | null {
  if (!platformMetrics || typeof platformMetrics !== "object") return null;
  const stamp = (platformMetrics as Record<string, unknown>)[LAST_FETCH_KEY];
  if (!stamp || typeof stamp !== "object") return null;
  const at = (stamp as Record<string, unknown>).at;
  if (typeof at !== "string") return null;
  const parsed = new Date(at);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseBudget(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_PLATFORM_BUDGET;
}

export async function GET(request: NextRequest) {
  const log = createLogger({ context: { route: "cron/sync-posts" } });

  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    log.warn("auth failed", { reason: "bad-or-missing-cron-secret" });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dryRun = request.nextUrl.searchParams.get("dryRun") === "1";
  const now = new Date();
  const deadline = Date.now() + 4 * 60 * 1000;

  const budgets: Record<string, number> = {
    YOUTUBE: parseBudget(process.env.SYNC_BUDGET_YOUTUBE),
    TIKTOK: parseBudget(process.env.SYNC_BUDGET_TIKTOK),
    INSTAGRAM: parseBudget(process.env.SYNC_BUDGET_INSTAGRAM),
  };
  const attempts: Record<string, number> = {};

  let synced = 0;
  let noCounts = 0;
  const noCountReasons: Record<string, number> = {};
  let sealed = 0;
  let unavailable = 0;
  let failed = 0;
  let deadLettered = 0;
  let skippedForBudget = 0;
  const decisions: Decision[] = [];
  /* Campaigns this run actually spent a request on. Only these get their
     lastRefreshAt moved -- a campaign whose posts were all throttled by cadence,
     or cut off by the deadline, has not been refreshed and must stay due. */
  const sweptCampaigns = new Set<string>();

  try {
    /* Ask which campaigns are due before pulling a single post.
       This route used to take the oldest 300 posts across every live campaign,
       every hour, regardless of whether anyone wanted those numbers refreshed.
       Most campaigns are not due in a given hour, so filtering here is the one
       change in this file that reduces both bills at once: fewer rows read from
       Neon, fewer rows written back, and fewer function-seconds spent on posts
       whose owners had already said how often they wanted them looked at. */
    const campaigns = await db.campaign.findMany({
      where: { status: { in: ["IN_PROGRESS", "PENDING"] }, deletedAt: null },
      select: { id: true, refreshActive: true, refreshInterval: true, lastRefreshAt: true },
    });
    const dueCampaignIds = campaigns.filter((c) => isCampaignDue(c, now)).map((c) => c.id);
    log.info("campaign refresh cadence", {
      liveCampaigns: campaigns.length,
      dueCampaigns: dueCampaignIds.length,
    });

    const posts = await db.post.findMany({
      where: {
        campaignId: { in: dueCampaignIds },
        syncDisabledAt: null,
        snapshots: { none: { isFinalSnapshot: true } },
      },
      select: {
        id: true,
        platform: true,
        postUrl: true,
        postedAt: true,
        campaignId: true,
        /* The last four are for applyPostMetrics, which needs a SyncablePost:
           creatorId to write back the author's follower count, thumbnail and
           caption so an absent one is not clobbered with null, and
           platformMetrics because the measured-fields list is merged into that
           bag alongside the importer's raw record rather than replacing it. */
        creatorId: true,
        thumbnailUrl: true,
        caption: true,
        platformMetrics: true,
        lastSyncedAt: true,
        viewsCount: true,
        likesCount: true,
        commentsCount: true,
        sharesCount: true,
        engagementRate: true,
        syncFailCount: true,
        syncDisabledAt: true,
        trackingEnabled: true,
        trackingStartedAt: true,
        snapshots: { where: { isFinalSnapshot: true }, take: 1, select: { id: true } },
        creator: {
          select: {
            orgId: true,
            handle: true,
            socialAccounts: {
              where: { platform: { in: ["INSTAGRAM", "TIKTOK"] } },
              select: {
                id: true,
                platform: true,
                accessToken: true,
                refreshToken: true,
                handle: true,
                tokenExpiry: true,
              },
            },
          },
        },
      },
      orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
      take: 300,
    });

    const youtubeIds: string[] = [];
    for (const p of posts) {
      if (p.platform !== "YOUTUBE") continue;
      const d = detectPlatform(p.postUrl);
      if (d?.platform === "YOUTUBE") youtubeIds.push(d.id);
    }
    const youtubeCache: Map<string, PostMetrics> = dryRun
      ? new Map()
      : await fetchYouTubeMetricsBatch(youtubeIds);

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      if (!dryRun && Date.now() > deadline) {
        skippedForBudget += posts.length - i;
        break;
      }

      let { action, reason } = decideSyncAction({
        postedAt: new Date(post.postedAt),
        lastSyncedAt: post.lastSyncedAt ? new Date(post.lastSyncedAt) : null,
        lastAttemptAt: lastAttemptFrom(post.platformMetrics),
        syncFailCount: post.syncFailCount,
        syncDisabledAt: post.syncDisabledAt ? new Date(post.syncDisabledAt) : null,
        hasFinalSnapshot: post.snapshots.length > 0,
        trackingEnabled: post.trackingEnabled ?? false,
        trackingStartedAt: post.trackingStartedAt ? new Date(post.trackingStartedAt) : null,
        now,
      });

      /* This route cannot read TikTok, so it should stop trying.
         It opens no sandbox, so a TikTok read here goes out through function
         egress -- which TikTok answers with a 1.4KB WAF shell about three times
         in four. Those attempts cost function-seconds and a Neon write each, and
         until the guard below they also spent the post's retry budget, which is
         how an unreadable TikTok post reached a permanent dead-letter in five
         hours. They also record into the process-wide breaker, so an hourly cron
         could latch it and silence a real user's Refresh on the same instance.
         TikTok refreshes on demand, where a sandbox pool is already opened.
         Giving this route its own pool is the way to bring it back, and it costs
         real Vercel compute -- see the plan; it is a deliberate omission, not an
         oversight. */
      if (action === "sync" && post.platform === "TIKTOK") {
        action = "skip";
        reason = "tiktok-needs-sandbox";
      }

      if (action === "sync") {
        const platform = post.platform as string;
        const budget = budgets[platform] ?? DEFAULT_PLATFORM_BUDGET;
        const used = attempts[platform] ?? 0;
        if (used >= budget) {
          action = "skip";
          reason = "budget";
        } else {
          attempts[platform] = used + 1;
          sweptCampaigns.add(post.campaignId);
        }
      }

      decisions.push({ postId: post.id, platform: post.platform as string, action, reason });

      if (dryRun) continue;

      if (action === "skip") {
        if (reason === "budget") skippedForBudget++;
        continue;
      }

      if (action === "seal") {
        try {
          await db.$transaction([
            db.postMetricSnapshot.create({
              data: {
                postId: post.id,
                viewsCount: post.viewsCount,
                likesCount: post.likesCount,
                commentsCount: post.commentsCount,
                sharesCount: post.sharesCount,
                engagementRate: post.engagementRate,
                isFinalSnapshot: true,
                syncSource: "cron-seal",
              },
            }),
            db.post.update({ where: { id: post.id }, data: { lastSyncedAt: now } }),
          ]);
          sealed++;
        } catch (err) {
          log.error("failed to seal post", { postId: post.id, error: String(err) });
          failed++;
        }
        continue;
      }

      try {
        const igAccount = post.creator.socialAccounts.find((a) => a.platform === "INSTAGRAM");
        const ttAccount = post.creator.socialAccounts.find((a) => a.platform === "TIKTOK");
        const instagramToken =
          post.platform === "INSTAGRAM"
            ? await ensureFreshInstagramToken(igAccount, post.creator.orgId)
            : undefined;
        const instagramHandle =
          post.platform === "INSTAGRAM"
            ? (igAccount?.handle ?? post.creator.handle ?? undefined)
            : undefined;
        const tiktokToken =
          post.platform === "TIKTOK"
            ? await ensureFreshTikTokToken(ttAccount, post.creator.orgId)
            : undefined;
        const detected = post.platform === "YOUTUBE" ? detectPlatform(post.postUrl) : null;
        const cached = detected ? youtubeCache.get(detected.id) : undefined;
        const metrics =
          cached ??
          (await fetchPostMetrics(post.postUrl, {
            instagramToken,
            instagramHandle,
            tiktokToken,
          }));
        if (!metrics) continue;

        /* The shared writer, not a local one.
         *
         * What used to be here built `{ lastSyncedAt: now, syncFailCount: 0 }`
         * and wrote it on BOTH branches -- so a fetch that came back with no
         * counts still marked the post as synced and cleared its fail streak.
         * Since lastSyncedAt is the only thing distinguishing "no likes" from
         * "nobody looked" (see lib/sync/syncPost), this ran hourly against
         * production and turned unknowns into measured zeros, while the reset
         * counter meant a genuinely dead post could never reach
         * MAX_SYNC_FAILURES and dead-letter. It also silently undid every
         * repair the on-demand refresh made.
         *
         * applyPostMetrics stamps lastSyncedAt only when counts actually
         * arrived, and writes only the counters the platform reported. */
        const outcome = await applyPostMetrics(post, metrics, { syncSource: "cron" });

        if (outcome.status === "measured") {
          // A real answer clears the streak. Only a real answer.
          if (post.syncFailCount > 0) {
            await db.post.update({ where: { id: post.id }, data: { syncFailCount: 0 } });
          }
          synced++;
        } else {
          /* Answered, but with nothing countable. That is a failed attempt for
             backoff purposes -- counting it is what lets a post the platform
             will never answer for eventually stop being asked. A settled reason
             goes straight to the dead letter rather than spending five hours
             re-confirming a deletion. */
          noCounts++;
          noCountReasons[outcome.reason] = (noCountReasons[outcome.reason] ?? 0) + 1;
          /* A rejected credential is not the platform being coy about a post --
             an unauthenticated read returns no counts, which looks exactly like
             a post with no engagement. applyPostMetrics has already declined to
             stamp lastSyncedAt, so nothing is recorded as a success; this is
             what puts the cause somewhere a person will see it. */
          if (outcome.reason === "credentials-rejected") {
            unavailable++;
            log.warn("skipped post; platform credentials could not be used", {
              postId: post.id,
              platform: post.platform,
              reason: outcome.reason,
            });
          }
          /* None of these is a statement about the post, so none of them may
             spend the post's retry budget. syncFailCount exists to stop us
             hammering a post the platform will never answer for; a shut gate, a
             WAF challenge to our egress, a dead sandbox lane, a lapsed token and
             a missing API key are all about US or about the moment.

             Letting any of them reach MAX_SYNC_FAILURES switches off a healthy
             post for good, and silently: syncDisabledAt removes it from this
             route's own query, nothing in this codebase ever sets that column
             back to null, and a successful on-demand refresh does not clear it
             either. Five hourly runs is five hours to permanent. Counted and
             logged, just never charged. */
          if (UNCHARGEABLE_REASONS.has(outcome.reason)) {
            log.warn("left unmeasured by something other than the post; not charged to it", {
              postId: post.id,
              platform: post.platform,
              reason: outcome.reason,
              syncFailCount: post.syncFailCount,
            });
            continue;
          }
          const settled = SETTLED_REASONS.has(outcome.reason);
          const nextFailCount = settled ? MAX_SYNC_FAILURES : post.syncFailCount + 1;
          const failData: Record<string, unknown> = { syncFailCount: nextFailCount };
          if (nextFailCount >= MAX_SYNC_FAILURES) {
            failData.syncDisabledAt = now;
            deadLettered++;
          }
          await db.post.update({ where: { id: post.id }, data: failData });
        }
      } catch (err) {
        log.error("failed to sync post", { postId: post.id, error: String(err) });
        failed++;
        const nextFailCount = post.syncFailCount + 1;
        const failData: Record<string, unknown> = { syncFailCount: nextFailCount };
        if (nextFailCount >= MAX_SYNC_FAILURES) {
          failData.syncDisabledAt = now;
          deadLettered++;
        }
        try {
          await db.post.update({ where: { id: post.id }, data: failData });
        } catch (updateErr) {
          log.error("failed to record sync failure", { postId: post.id, error: String(updateErr) });
        }
      }
    }

    if (dryRun) {
      const byAction: Record<string, number> = {};
      const byReason: Record<string, number> = {};
      for (const d of decisions) {
        byAction[d.action] = (byAction[d.action] ?? 0) + 1;
        byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
      }
      log.info("dry-run complete", { total: posts.length, byAction, byReason });
      return NextResponse.json({
        ok: true,
        dryRun: true,
        total: posts.length,
        decisions,
        summary: { byAction, byReason },
      });
    }

    /* One write for the whole run, not one per campaign. Without this the
       cadence filter never advances and every campaign stays permanently due,
       which would quietly restore the old sweep-everything behaviour while
       looking like it had been fixed. */
    if (sweptCampaigns.size > 0) {
      await db.campaign.updateMany({
        where: { id: { in: [...sweptCampaigns] } },
        data: { lastRefreshAt: now },
      });
    }

    /* Every skip that was not a budget skip used to vanish from the tally, so a
       run that looked at 115 posts and deliberately synced none of them logged
       synced:0 failed:0 skippedForBudget:0 total:115 -- indistinguishable from a
       cron that fired and did nothing at all. The cadence reasons are already on
       `decisions`; counting them costs nothing and is the difference between
       "throttled, as designed" and "broken". */
    const skippedByReason: Record<string, number> = {};
    for (const d of decisions) {
      if (d.action !== "skip") continue;
      skippedByReason[d.reason] = (skippedByReason[d.reason] ?? 0) + 1;
    }
    const skipped = Object.values(skippedByReason).reduce((a, b) => a + b, 0);

    log.info("sync complete", {
      synced, noCounts, noCountReasons, unavailable, sealed, failed, deadLettered, skipped,
      skippedByReason, skippedForBudget, total: posts.length,
    });

    // One digest per run, never per post: a platform outage fails the whole
    // batch, and 500 emails would be worse than none.
    if (shouldAlertOnBatch({ failed, total: posts.length })) {
      await alertOps({
        source: "cron/sync-posts",
        title: `Post metric sync failing: ${failed}/${posts.length} posts`,
        severity: "critical",
        facts: { synced, sealed, failed, deadLettered, skippedForBudget, total: posts.length },
      });
    } else if (deadLettered > 0) {
      // Dead-lettered posts stop syncing forever until someone intervenes.
      await alertOps({
        source: "cron/sync-posts",
        title: `${deadLettered} post(s) dead-lettered and will no longer sync`,
        facts: { deadLettered, failed, total: posts.length },
      });
    }
    return NextResponse.json({
      ok: true,
      synced,
      /* Surfaced because "fetched but nothing countable came back" is the state
         this route used to report as a success, and it is the one worth
         watching: a run of synced:0 noCounts:300 is a platform locking us out,
         not a quiet hour. */
      noCounts,
      noCountReasons,
      /* Broken out of noCountReasons by name because it is the one entry there
         with a human remedy: a creator must reconnect Instagram, or an operator
         must replace INSTAGRAM_BUSINESS_TOKEN. Left inside the map it reads as
         just another way a fetch came back thin. */
      unavailable,
      sealed,
      failed,
      deadLettered,
      skipped,
      skippedByReason,
      skippedForBudget,
      total: posts.length,
    });
  } catch (error) {
    log.error("cron run failed", { error: String(error) });
    await alertOps({
      source: "cron/sync-posts",
      title: "Post metric sync crashed",
      severity: "critical",
      facts: { error: String(error).slice(0, 300) },
    });
    return NextResponse.json({ error: "Sync failed" }, { status: 500 });
  }
}
