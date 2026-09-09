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
import {
  laneCountFor,
  type SandboxPostFetcher,
} from "@/lib/platforms/tiktokPostSandbox";
import { openTikTokPostFetcher } from "@/lib/platforms/tiktokEgress";
import { ensureFreshInstagramToken } from "@/lib/platforms/instagramToken";
import { ensureFreshTikTokToken } from "@/lib/platforms/tiktokToken";
import { decidePostTracking, type PostTrackingAction } from "@/lib/sync/postTracking";
import { parsePostTracking, type PostTrackingGranularity } from "@/lib/trackers/granularity";
import { LAST_FETCH_KEY } from "@/lib/metricDisplay";
import { alertOps, shouldAlertOnBatch } from "@/lib/alerts";
import { alertIfInstagramSourceDown } from "@/lib/integrations/health";
import { createLogger } from "@/lib/observability/logger";

const MAX_SYNC_FAILURES = 5;
const DEFAULT_PLATFORM_BUDGET = 100;

/* The campaign cadence gate that used to live here is gone.

   It asked whether a campaign was IN_PROGRESS/PENDING and due on
   `Campaign.refreshInterval`, honouring CreatorCore's 9999 = "never" sentinel.
   Measured on prod 2026-09-09 that selected 103 posts out of 18,787 live ones,
   and the status filter is what did most of it: 497 of ~500 campaigns are
   COMPLETE. The sentinel changes nothing for live campaigns -- the same 102
   untracked posts come back whether it is honoured or ignored. Neither half
   represented a preference anyone expressed.

   What decides now is the post tracker itself -- on, unexpired, and due on its
   org's read cadence. Campaign status, refreshActive and refreshInterval no
   longer gate this route at all. See lib/sync/postTracking.ts. */

/* Reasons a further attempt cannot change. Both are things a platform states
   positively about the post, so re-asking hourly for five hours before
   dead-lettering only delays the same answer. Everything else -- a WAF
   challenge, a refusal, a shut gate, an unexplained empty -- is about the
   moment or about us, and deserves the retries. */
const SETTLED_REASONS: ReadonlySet<FetchReason> = new Set<FetchReason>([
  "post-deleted",
  "unrecognised-url",
]);

type Decision = { postId: string; platform: string; action: PostTrackingAction; reason: string };

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

/** The counters a seal preserves. Both callers -- the bulk expiry pass and the
 *  in-loop decision -- select exactly these. */
type SealablePost = {
  id: string;
  lastSyncedAt: Date | null;
  viewsCount: number;
  likesCount: number;
  commentsCount: number;
  sharesCount: number;
  reachCount: number;
  engagementRate: number;
};

/**
 * Retire a post: write the final snapshot, stop the tracker, and leave the
 * measurement question alone.
 *
 * The seal is what makes a post stop costing anything -- the candidate query
 * excludes anything holding an isFinalSnapshot row, and nothing in this codebase
 * ever removes one. So it must land even for a post we never once measured,
 * or that post is re-decided every hour forever.
 *
 * What must NOT happen is the seal claiming a measurement. Every counter is a
 * non-nullable Float defaulting to 0, so lastSyncedAt is the sole discriminator
 * between "no likes" and "nobody looked" (lib/metricDisplay, metricValue).
 * Stamping it here would convert a whole cohort of never-measured posts into
 * measured zeros across the Posts tab, the report and the PDF. So the snapshot
 * always lands and lastSyncedAt moves only for a post that had a real reading.
 *
 * trackingEnabled goes false because the tracker is over, and the UI reads that
 * flag to decide whether to offer Stop or Renew.
 */
async function sealPost(post: SealablePost, syncSource: string, at: Date = new Date()) {
  const neverMeasured = post.lastSyncedAt === null;
  await db.$transaction([
    db.postMetricSnapshot.create({
      data: {
        postId: post.id,
        viewsCount: post.viewsCount,
        likesCount: post.likesCount,
        commentsCount: post.commentsCount,
        sharesCount: post.sharesCount,
        /* Absent here, the seal asserted reach was never measured on the one row
           nothing ever revisits. savesCount and downloadsCount are still missing
           for the same reason -- flagged, not fixed here. */
        reachCount: post.reachCount,
        engagementRate: post.engagementRate,
        isFinalSnapshot: true,
        syncSource,
      },
    }),
    db.post.update({
      where: { id: post.id },
      data: { trackingEnabled: false, ...(neverMeasured ? {} : { lastSyncedAt: at }) },
    }),
  ]);
}

function parseBudget(raw: string | undefined): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_PLATFORM_BUDGET;
}

/**
 * How many sandbox lanes one cron run may hold open for TikTok.
 *
 * Two, not laneCountFor's eight. The on-demand refresh sizes its pool for a
 * fast finish because a person is waiting on it; nobody is waiting on the
 * cron, so it can take the whole four-minute budget on a couple of addresses.
 * Sandboxes bill by lifetime, and the lifetime here is bounded by the run --
 * measured on prod 2026-09-07: 13 TikTok posts due per hour, which is ~23
 * sandbox-seconds at LANE_SECONDS_PER_POST. SYNC_BUDGET_TIKTOK caps the reads
 * themselves, so the cost ceiling is budget x 1.8s per hour whatever this is.
 */
const DEFAULT_CRON_TIKTOK_LANES = 2;
function cronTikTokLanes(due: number): number {
  const raw = Number(process.env.SYNC_CRON_TIKTOK_MAX_LANES);
  const cap = Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_CRON_TIKTOK_LANES;
  return Math.min(cap, laneCountFor(due));
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
  let instagramCredentialsRejected = 0;
  let failed = 0;
  let deadLettered = 0;
  let skippedForBudget = 0;
  const decisions: Decision[] = [];
  /* Campaigns this run actually spent a request on. lastRefreshAt no longer
     gates anything -- the post tracker does -- but it is still what the campaign
     screens and lib/refreshCooldown.ts show as "last refreshed", so it is kept
     accurate. Only campaigns actually read are stamped; one whose posts were all
     throttled or cut off by the deadline was not refreshed and must not claim it. */
  const sweptCampaigns = new Set<string>();

  /* Declared outside the try so the finally can close it: a pool left open
     after a crash keeps billing until SANDBOX_LIFETIME_MS. */
  let tiktokSandbox: SandboxPostFetcher | undefined;
  try {
    /* Ask the trackers, not the campaigns.

       The candidate set is "someone turned tracking on for this post, and it has
       not sealed yet". Expiry is decided in code rather than filtered in SQL,
       because an expired tracker still has one job left -- to seal -- and it can
       only do that if the query returns it. It is returned at most once: sealing
       writes an isFinalSnapshot row, and the filter below excludes it from every
       run afterwards. So the expired backlog is only ever "lapsed since the last
       run", never the whole history.

       That also keeps the null case honest. A null trackingExpiresAt is a row
       written before the column existed; effectiveExpiry() gives it a window
       measured from trackingStartedAt rather than sealing it on sight, and no
       WHERE clause could express that. */
    const posts = await db.post.findMany({
      where: {
        trackingEnabled: true,
        syncDisabledAt: null,
        snapshots: { none: { isFinalSnapshot: true } },
        /* A deleted campaign's posts stop being read. This used to fall out of
           the campaign query; with campaigns no longer gating the sweep it has
           to be said. */
        campaign: { deletedAt: null },
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
        reachCount: true,
        engagementRate: true,
        syncFailCount: true,
        syncDisabledAt: true,
        trackingEnabled: true,
        trackingStartedAt: true,
        trackingTtlDays: true,
        trackingExpiresAt: true,
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

    /* Read cadence and default TTL are per organisation, so one lookup for the
       orgs actually represented in this batch -- not one per post, and not the
       whole table. An org with no stored preference gets DEFAULT_POST_TRACKING. */
    const orgIds = [...new Set(posts.map((p) => p.creator.orgId))];
    const orgs = orgIds.length
      ? await db.organization.findMany({
          where: { id: { in: orgIds } },
          select: { id: true, uiConfig: true },
        })
      : [];
    const granularityByOrg = new Map<string, PostTrackingGranularity>(
      orgs.map((o) => [o.id, parsePostTracking(o.uiConfig)]),
    );
    const granularityFor = (orgId: string): PostTrackingGranularity =>
      granularityByOrg.get(orgId) ?? parsePostTracking(null);

    /* One place that builds the decision input, because it is asked twice: once
       to size the TikTok sandbox pool before the loop, once per post inside it.
       Two hand-rolled copies of this object is how the pre-pass and the loop
       drift apart and the pool gets sized for a different set than it serves. */
    const decisionFor = (post: (typeof posts)[number]) =>
      decidePostTracking({
        trackingEnabled: post.trackingEnabled ?? false,
        trackingStartedAt: post.trackingStartedAt ? new Date(post.trackingStartedAt) : null,
        trackingExpiresAt: post.trackingExpiresAt ? new Date(post.trackingExpiresAt) : null,
        trackingTtlDays: post.trackingTtlDays ?? null,
        lastSyncedAt: post.lastSyncedAt ? new Date(post.lastSyncedAt) : null,
        lastAttemptAt: lastAttemptFrom(post.platformMetrics),
        syncDisabledAt: post.syncDisabledAt ? new Date(post.syncDisabledAt) : null,
        hasFinalSnapshot: post.snapshots.length > 0,
        granularity: granularityFor(post.creator.orgId),
        now,
      });

    log.info("post tracker sweep", {
      trackedCandidates: posts.length,
      orgs: orgIds.length,
      capped: posts.length === 300,
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

    /* TikTok is read through a Vercel Sandbox, the same lane the on-demand
       refresh uses, because TikTok's WAF answers this project's function
       egress with a 1.4KB login shell about three times in four (measured
       2026-09-02) and a sandbox's egress with the full page every time.

       This route used to skip TikTok outright instead -- "tiktok-needs-sandbox"
       -- to keep the Vercel bill flat, on an estimate of $111-174/mo for lanes
       on every campaign every hour. The cadence filter changed the arithmetic:
       only due posts of live campaigns reach this loop, and on prod that was 13
       TikTok posts an hour (2026-09-07), every one of them skipped. The result
       was 15,403 live TikTok posts whose counts moved only when someone pressed
       Refresh, which is the silent stale number the product promises not to
       show. A couple of lanes for the length of one run costs cents a day and
       is capped twice: SYNC_CRON_TIKTOK_MAX_LANES on addresses, and
       SYNC_BUDGET_TIKTOK on reads.

       Sized before the loop because the decision is per post but the pool is
       per run; decidePostTracking is pure, so asking it twice costs nothing. The
       pool boots lazily, so a run with no due TikTok post never creates a
       sandbox at all. */
    const tiktokDue = dryRun
      ? 0
      : posts.filter((p) => p.platform === "TIKTOK" && decisionFor(p).action === "sync").length;
    /* The lane cap is passed through rather than recomputed, because it is a
       cost decision this route made on purpose: two sandboxes, not
       laneCountFor's eight, since nobody is waiting on a cron run. It bounds
       only the SANDBOX fallback -- a proxy identity is a session string with no
       standing cost, so when proxies are configured the run reads through those
       first and boots a sandbox only for posts they could not deliver. Setting
       SYNC_CRON_TIKTOK_MAX_LANES=0 then means "proxies only, never boot one". */
    const lanes = cronTikTokLanes(tiktokDue);
    tiktokSandbox = openTikTokPostFetcher(tiktokDue, { sandboxLanes: lanes });
    if (tiktokSandbox) {
      log.info("tiktok egress opened", { lanes: tiktokSandbox.size, sandboxLanes: lanes, tiktokDue });
    }

    for (let i = 0; i < posts.length; i++) {
      const post = posts[i];
      if (!dryRun && Date.now() > deadline) {
        skippedForBudget += posts.length - i;
        break;
      }

      let { action, reason } = decisionFor(post);

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
        /* Reached by a tracker whose expiry was null in SQL but lapsed once
           effectiveExpiry() applied the org default. The bulk pass above cannot
           express that in a WHERE clause, so it lands here instead. */
        try {
          await sealPost(post, "cron-seal-ttl", now);
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
            tiktokSandbox,
            /* Counts only for TikTok: every post here already has its
               thumbnail, and oEmbed cannot return a counter, so a paced lane
               slot spent on it would buy nothing. Left off for the others so
               their behaviour here is unchanged. */
            countsOnly: post.platform === "TIKTOK",
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
            /* Counted apart from `unavailable` because the two have different
               owners. A rejected credential on a TikTok or YouTube post, or on
               an Instagram post whose creator's own token lapsed, is not the
               platform token -- and only the platform token is worth emailing
               an operator about. The count is the trigger; the probe at the end
               of the run is the diagnosis. */
            if (post.platform === "INSTAGRAM") instagramCredentialsRejected++;
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
        /* Counted and logged, never charged.

           A throw out of this block is a token refresh that 500'd, a sandbox
           lane that died, a Neon blip, a JSON parse against a WAF page -- ours
           or the moment's, never a statement the platform made about the post.
           The no-counts branch above already refuses to charge exactly that
           class of cause (UNCHARGEABLE_REASONS), and this path bypassed the
           whole distinction: any five thrown errors, however transient, walked
           a healthy post to syncDisabledAt, which removes it from this route's
           own query and which nothing in this codebase ever sets back to null.
           Five hourly DB blips is five hours to permanently dark.

           The post stays eligible, so the next run tries it again; `failed`
           still counts it, so a run where everything throws still alerts. A
           post the PLATFORM has nothing to say about still dead-letters, via
           the charged branch above. */
        log.error("failed to sync post; not charged to the post", {
          postId: post.id,
          platform: post.platform,
          syncFailCount: post.syncFailCount,
          error: String(err),
        });
        failed++;
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

    /* Informational only, since the sweep is driven by post trackers now.
       Kept because the campaign header and the MCP tools read it, and a frozen
       "last refreshed" reads as a broken sync even when the trackers are fine. */
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
      synced, noCounts, noCountReasons, unavailable, instagramCredentialsRejected,
      sealed, failed, deadLettered, skipped,
      skippedByReason, skippedForBudget, total: posts.length,
    });

    /* One digest per run, never per post: a platform outage fails the whole
       batch, and 500 emails would be worse than none.

       The signal is every attempt that produced no number, not just the ones
       that threw. `failed` counts throws only, and a total lockout does not
       throw: TikTok answering 300 posts with a WAF challenge is 300 clean
       no-counts outcomes, failed:0, and the loudest possible outage went
       unalerted. `noCounts` is that case, and the two are the same event from
       the operator's side -- we asked and learned nothing.

       Measured against attempts rather than posts.length, which includes every
       post the cadence throttled: a run that attempted 6 and got nothing back
       is an outage, and dividing it by 300 considered posts hides it under the
       ratio. shouldAlertOnBatch's minFailures still keeps a two-post batch from
       waking anyone. */
    const attempted = synced + noCounts + failed;
    const unproductive = noCounts + failed;
    if (shouldAlertOnBatch({ failed: unproductive, total: attempted })) {
      await alertOps({
        source: "cron/sync-posts",
        title: `Post metric sync returning nothing: ${unproductive}/${attempted} attempts`,
        severity: "critical",
        facts: {
          synced, sealed, failed, noCounts, noCountReasons, deadLettered,
          skippedForBudget, attempted, total: posts.length,
        },
      });
    } else if (deadLettered > 0) {
      // Dead-lettered posts stop syncing forever until someone intervenes.
      await alertOps({
        source: "cron/sync-posts",
        title: `${deadLettered} post(s) dead-lettered and will no longer sync`,
        facts: { deadLettered, failed, total: posts.length },
      });
    }
    /* Aggregation point, not the fetch loop: the loop runs per post and would
       mail per post. A rejected Instagram credential is only the trigger here --
       it can equally be one creator's own lapsed token -- so the probe inside
       decides whether the platform token is what died, and its own 24h throttle
       decides whether anyone hears about it again today. */
    let instagramSourceAlert: { alerted: boolean; reason: string } | null = null;
    if (instagramCredentialsRejected > 0) {
      instagramSourceAlert = await alertIfInstagramSourceDown({
        rejectedPosts: instagramCredentialsRejected,
        totalPosts: posts.length,
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
      /* Broken out again for the same reason `unavailable` is: this is the
         subset with a platform-level remedy, and it is what decided whether an
         operator was emailed. */
      instagramCredentialsRejected,
      instagramSourceAlert,
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
  } finally {
    await tiktokSandbox?.close();
  }
}
