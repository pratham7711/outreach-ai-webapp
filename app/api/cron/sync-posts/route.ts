import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import type { Platform, Prisma } from "@/lib/generated/prisma/client";
import {
  SWEEP_PLATFORMS,
  candidateTake,
  roundRobin,
  selectSweepCandidates,
  type SweepQuery,
  type SweepTier,
} from "@/lib/sync/sweepCandidates";
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
import { ensureFreshInstagramToken, INSTAGRAM_HANDLE_SELECT, instagramLookupHandle } from "@/lib/platforms/instagramToken";
import { ensureFreshTikTokToken } from "@/lib/platforms/tiktokToken";
import { isInstagramLoginRow } from "@/lib/platforms/accountOrigin";
import {
  DAILY_RECHECK_REASONS,
  decidePostTracking,
  isLiveCampaign,
  sealSource,
  type PostTrackingAction,
} from "@/lib/sync/postTracking";
import { parsePostTracking, type PostTrackingGranularity } from "@/lib/trackers/granularity";
import { LAST_FETCH_KEY, MEASURED_FIELDS_KEY, lastFetchNote, measuredFields } from "@/lib/metricDisplay";
import { alertOps, shouldAlertOnBatch } from "@/lib/alerts";
import { alertIfInstagramSourceDown } from "@/lib/integrations/health";
import { createLogger } from "@/lib/observability/logger";
import { cronRoute } from "@/lib/ops/cronRoute";
import { classifyPostRead, openSourceGuard } from "@/lib/ops/sourceBreaker";
import { grantedConnectionKeys, readableConnection } from "@/lib/creators/connectionGate";

const MAX_SYNC_FAILURES = 5;
const DEFAULT_PLATFORM_BUDGET = 100;

/* Reads one run may spend, per platform, unless SYNC_BUDGET_<PLATFORM> says
   otherwise. These were a flat 100 that no run ever spent: until the reads ran
   concurrently, a run was over at the four-minute deadline first. Measured on
   prod across the eight runs of 2026-10-01/02: 30-45 TikTok and 63-86 YouTube
   posts measured per run, and the 18:00 run took 243.6s.

   YouTube's is the large one because it is nearly free: 600 ids are twelve
   batched videos.list calls (fetchYouTubeMetricsBatch), and the rest is the
   database write. TikTok's is 50 per address at DEFAULT_CRON_TIKTOK_LANES, the
   same load per address the old 100-over-two-lanes ceiling allowed. Instagram's
   stays where it was: one business token serves every org's reads. */
const DEFAULT_PLATFORM_BUDGETS: Record<string, number> = {
  YOUTUBE: 600,
  TIKTOK: 300,
  INSTAGRAM: DEFAULT_PLATFORM_BUDGET,
};

/* Reads in flight at once, per platform. TikTok's is the pool's lane count --
   one worker per lane, the way refreshCampaign drives the same pool -- so it is
   not in this table. YouTube's reads are already in memory by the time the
   loop reaches them, so its workers only overlap database writes. Instagram's
   is two because every org's reads share one token's hourly quota. */
const READ_CONCURRENCY: Record<string, number> = {
  YOUTUBE: 4,
  INSTAGRAM: 2,
};

/* The campaign cadence gate that used to live here is gone.

   It asked whether a campaign was IN_PROGRESS/PENDING and due on
   `Campaign.refreshInterval`, honouring CreatorCore's 9999 = "never" sentinel.
   Measured on prod 2026-09-09 that selected 103 posts out of 18,787 live ones,
   and the status filter is what did most of it: 497 of ~500 campaigns are
   COMPLETE. The sentinel changes nothing for live campaigns -- the same 102
   untracked posts come back whether it is honoured or ignored. Neither half
   represented a preference anyone expressed.

   What decides now is the post's coverage -- its tracker, its first month, or
   its campaign still running -- and the read cadence that goes with it.
   refreshActive and refreshInterval no longer gate this route at all. See
   postCoverage in lib/sync/postTracking.ts, and lib/sync/sweepCandidates.ts for
   the order the candidates are asked in. */

/* Reasons a further attempt cannot change. Both are things a platform states
   positively about the post, so re-asking hourly for five hours before
   dead-lettering only delays the same answer. Everything else -- a WAF
   challenge, a refusal, a shut gate, an unexplained empty -- is about the
   moment or about us, and deserves the retries. */
const SETTLED_REASONS: ReadonlySet<FetchReason> = new Set<FetchReason>([
  "post-deleted",
  "unrecognised-url",
]);

/* Empty reads that were still answers about the post or its account, so the
   outage alert leaves them out. */
const ANSWERED_REASONS: ReadonlySet<FetchReason> = new Set<FetchReason>([
  ...SETTLED_REASONS,
  "no-counts-published",
  "not-a-professional-account",
  "post-hidden",
  /* Answered, with numbers that contradicted each other. A post TikTok keeps
     answering this way does so every run, and five of them inside a ten-post
     run would page as an outage. */
  "counts-inconsistent",
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
  savesCount: number;
  downloadsCount: number;
  reachCount: number;
  engagementRate: number;
  platformMetrics: unknown;
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
 * measured zeros across the Posts tab, the report and the PDF. Nor does it move
 * for a post that WAS measured: the seal reads nothing, so its counters are as
 * old as the last real read, and a fresh stamp told every "As of" label the
 * opposite (22 of 57 sealed posts on production, measured 2026-10-03). The
 * snapshot always lands; lastSyncedAt never moves.
 *
 * The snapshot carries the post's measured list, or an empty one for a post
 * nobody read, so its zeros read as unknown the way the post's own do.
 *
 * trackingEnabled goes false because the tracker is over, and the UI reads that
 * flag to decide whether to offer Stop or Renew.
 */
async function sealPost(post: SealablePost, syncSource: string, at: Date = new Date()) {
  const measured = measuredFields(post.platformMetrics) ?? (post.lastSyncedAt === null ? [] : null);
  await db.$transaction([
    db.postMetricSnapshot.create({
      data: {
        postId: post.id,
        viewsCount: post.viewsCount,
        likesCount: post.likesCount,
        commentsCount: post.commentsCount,
        sharesCount: post.sharesCount,
        /* Absent here, the seal asserted these were never measured on the one
           row nothing ever revisits. */
        savesCount: post.savesCount,
        downloadsCount: post.downloadsCount,
        reachCount: post.reachCount,
        engagementRate: post.engagementRate,
        isFinalSnapshot: true,
        syncSource,
        recordedAt: at,
        ...(measured ? { platformMetrics: { [MEASURED_FIELDS_KEY]: measured } } : {}),
      },
    }),
    db.post.update({
      where: { id: post.id },
      data: { trackingEnabled: false },
    }),
  ]);
}

function parseBudget(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}


/**
 * How many sandbox lanes one cron run may hold open for TikTok.
 *
 * Six, not laneCountFor's eight. The on-demand refresh sizes its pool for a
 * fast finish because a person is waiting on it; nobody is waiting on the
 * cron. This was two, sized 2026-09-07 for 13 due TikTok posts an hour, and
 * the loop read one post at a time, so the second lane was never busy. After
 * 15,165 trackers were switched on, every run was cut off by the deadline
 * having read 30-45 of them (2026-10-01/02), against ~30,000 reads a day the
 * 12-hourly cadence asks for. The loop now keeps one read in flight per lane.
 *
 * cost-guard: ok -- lanes live only for the run: they boot on the first due
 * post and close in the route's finally, so the ceiling is six lanes x one
 * four-minute run x four runs a day, about 96 sandbox-minutes a day, and
 * nothing persists past the run. SYNC_BUDGET_TIKTOK caps the reads, and
 * SYNC_CRON_TIKTOK_MAX_LANES=2 puts the old ceiling back without a deploy.
 */
const DEFAULT_CRON_TIKTOK_LANES = 6;
function cronTikTokLanes(due: number): number {
  const raw = Number(process.env.SYNC_CRON_TIKTOK_MAX_LANES);
  const cap = Number.isInteger(raw) && raw >= 0 ? raw : DEFAULT_CRON_TIKTOK_LANES;
  return Math.min(cap, laneCountFor(due));
}

async function cronHandler(request: NextRequest) {
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
    YOUTUBE: parseBudget(process.env.SYNC_BUDGET_YOUTUBE, DEFAULT_PLATFORM_BUDGETS.YOUTUBE),
    TIKTOK: parseBudget(process.env.SYNC_BUDGET_TIKTOK, DEFAULT_PLATFORM_BUDGETS.TIKTOK),
    INSTAGRAM: parseBudget(process.env.SYNC_BUDGET_INSTAGRAM, DEFAULT_PLATFORM_BUDGETS.INSTAGRAM),
  };
  const attempts: Record<string, number> = {};

  let synced = 0;
  let noCounts = 0;
  const noCountReasons: Record<string, number> = {};
  let sealed = 0;
  let unavailable = 0;
  let instagramCredentialsRejected = 0;
  /* One of the posts the rejection happened on, kept so the alert can probe the
     public fallback rather than assert what it used to do. */
  let instagramRejectedSampleUrl: string | null = null;
  let failed = 0;
  let deadLettered = 0;
  /* The dead letters nobody explained: a post switched off after five reads that
     came back with nothing and said nothing about why. The settled ones -- the
     platform saying the post is gone -- are already on the post as a pill. */
  const unexplainedDeadLetters: Record<string, number> = {};
  let skippedForBudget = 0;
  const decisions: Decision[] = [];
  /* Campaigns this run actually measured a post for. lastRefreshAt no longer
     gates anything -- the post tracker does -- but it is still what the campaign
     screens and lib/refreshCooldown.ts show as "last refreshed", so it is kept
     accurate. Only campaigns actually read are stamped; one whose posts were all
     throttled or cut off by the deadline was not refreshed and must not claim it. */
  const sweptCampaigns = new Set<string>();

  /* Per-source kill switches and breakers (plan §13 C, lib/ops/sourceBreaker).
     A platform switched off, or whose breaker is open, is not asked for
     candidates at all; one whose breaker opens mid-run is skipped from then on
     as "source-breaker", uncharged, so its posts stay due. */
  const sourceGuard = await openSourceGuard({ reader: "post-reads", breakers: true });

  /* Declared outside the try so the finally can close it: a pool left open
     after a crash keeps billing until SANDBOX_LIFETIME_MS. */
  let tiktokSandbox: SandboxPostFetcher | undefined;
  try {
    /* Ask by coverage, in priority order (lib/sync/sweepCandidates.ts).

       A post is a candidate if its tracker is on, if it is in its first month,
       or if its campaign is still running -- and it has not sealed. Expiry is
       decided in code rather than filtered in SQL, because an expired tracker
       still has one job left -- to seal -- and it can only do that if the query
       returns it. It is returned at most once: sealing writes an isFinalSnapshot
       row, and every tier excludes it from every run afterwards.

       That also keeps the null case honest. A null trackingExpiresAt is a row
       written before the column existed; effectiveExpiry() gives it a window
       measured from trackingStartedAt rather than sealing it on sight, and no
       WHERE clause could express that exactly. */
    const candidateSelect = {
      id: true,
      platform: true,
      postUrl: true,
      postedAt: true,
      campaignId: true,
      /* Whether the campaign is still running is one of the reasons a post is
         read; see isLiveCampaign. */
      campaign: { select: { status: true, archived: true, deletedAt: true } },
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
      savesCount: true,
      downloadsCount: true,
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
          ...INSTAGRAM_HANDLE_SELECT,
          socialAccounts: {
            where: { platform: { in: ["INSTAGRAM", "TIKTOK"] } },
            select: {
              id: true,
              platform: true,
              accessToken: true,
              refreshToken: true,
              handle: true,
              tokenExpiry: true,
              origin: true,
            },
          },
        },
      },
    } satisfies Prisma.PostSelect;
    const findCandidates = (query: SweepQuery) =>
      db.post.findMany({ ...query, select: candidateSelect });
    type Candidate = Awaited<ReturnType<typeof findCandidates>>[number];
    const candidatesFor = (platform: Platform) =>
      selectSweepCandidates<Candidate>(findCandidates, {
        platform,
        budget: budgets[platform] ?? DEFAULT_PLATFORM_BUDGET,
        now,
        startedAtField: db.post.fields?.trackingStartedAt,
        readLast: (post) => DAILY_RECHECK_REASONS.has(lastFetchNote(post.platformMetrics)?.reason ?? ""),
      });

    /* One query per platform, not one query for all of them.
     *
     * The budgets above are per platform and are spent per platform, but the
     * candidate list used to be a single oldest-read-first query across every
     * row -- so which platforms got read was decided entirely by whichever one
     * had the biggest backlog. Measured on prod 2026-09-17, after 17,971
     * trackers were switched on in one action two days earlier: the next 300
     * candidates were 243 TikTok, 57 Instagram and 0 YouTube, and YouTube had
     * had zero reads in 24 hours with 2,236 of its 2,237 posts unread for more
     * than 48. Its 100-read budget went unspent on every single run.
     *
     * Asking each platform separately spends budgets that are already there.
     * It adds no reads beyond what the budgets already allow, and YouTube's are
     * nearly free anyway: they are answered by one batched API call per 50 ids
     * (fetchYouTubeMetricsBatch, below) rather than a request per post. */
    const selections = await Promise.all(
      SWEEP_PLATFORMS.map((p) =>
        sourceGuard.excludes(p)
          ? Promise.resolve({ posts: [] as Candidate[], byTier: null as Record<SweepTier, number> | null })
          : candidatesFor(p),
      ),
    );
    const byPlatform = selections.map((sel) => sel.posts);

    /* Interleaved, not concatenated. The reads no longer depend on this order
       -- each platform drains its own queue below, so a TikTok backlog cannot
       eat the clock before the cheap platforms are reached -- but it is still
       the order a dry run reports its decisions in. */
    const posts = roundRobin(byPlatform);

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
        postedAt: new Date(post.postedAt),
        campaignLive: isLiveCampaign(post.campaign),
        trackingEnabled: post.trackingEnabled ?? false,
        trackingStartedAt: post.trackingStartedAt ? new Date(post.trackingStartedAt) : null,
        trackingExpiresAt: post.trackingExpiresAt ? new Date(post.trackingExpiresAt) : null,
        trackingTtlDays: post.trackingTtlDays ?? null,
        lastSyncedAt: post.lastSyncedAt ? new Date(post.lastSyncedAt) : null,
        lastAttemptAt: lastAttemptFrom(post.platformMetrics),
        lastReason: lastFetchNote(post.platformMetrics)?.reason ?? null,
        syncDisabledAt: post.syncDisabledAt ? new Date(post.syncDisabledAt) : null,
        hasFinalSnapshot: post.snapshots.length > 0,
        granularity: granularityFor(post.creator.orgId),
        now,
      });

    /* Per platform, because a total alone cannot show starvation: 300 of 300
       read exactly the same whether it is three platforms or one. */
    const candidatesByPlatform = Object.fromEntries(
      SWEEP_PLATFORMS.map((p, i) => [p, byPlatform[i].length]),
    );
    /* And per tier, which is the number that says whether the young and the
       live posts were all reached: a tier that is non-zero below one that
       filled the take could not have been. */
    const candidatesByTier = Object.fromEntries(
      SWEEP_PLATFORMS.map((p, i) => [p, selections[i].byTier]),
    );
    log.info("post tracker sweep", {
      trackedCandidates: posts.length,
      candidatesByPlatform,
      candidatesByTier,
      orgs: orgIds.length,
      capped: SWEEP_PLATFORMS.some(
        (p, i) =>
          byPlatform[i].length - (selections[i].byTier?.seal ?? 0) ===
          candidateTake(budgets[p] ?? DEFAULT_PLATFORM_BUDGET),
      ),
    });

    /* Only the posts this run may read. Candidates now include trackers that
       only need sealing, and their ids would cost a batch slot each for an
       answer nothing uses. */
    const youtubeIds: string[] = [];
    for (const p of posts) {
      if (p.platform !== "YOUTUBE" || decisionFor(p).action !== "sync") continue;
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
       cost decision this route made on purpose: six sandboxes, not
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

    /* The grant gate, once for the whole run (lib/creators/connectionGate.ts):
       a connection is used only for the org that holds a live grant for it.
       null while the grant table does not exist yet -- every row is used, as
       before. A post whose connection is not granted reads the way an
       unconnected creator's does. A hand-entered row is never read as a
       connection, gate open or not (plan A8). */
    const granted = dryRun
      ? null
      : await grantedConnectionKeys(
          posts.flatMap((p) =>
            p.creator.socialAccounts.map((a) => ({ orgId: p.creator.orgId, connectionId: a.id })),
          ),
        );
    const readable = (orgId: string, account: { id: string; origin: string | null }) =>
      readableConnection(granted, orgId, account);

    /* The decision for one post, made at the moment a worker claims it:
       cadence, then the source breaker, then the platform's budget. It is
       synchronous on purpose. A budget check and its increment cannot be split
       by another worker's, so running reads side by side cannot overspend a
       budget or let more half-open probes through than the breaker allows. */
    const claim = (post: (typeof posts)[number]): Decision => {
      let { action, reason } = decisionFor(post);

      if (action === "sync" && !sourceGuard.admit(post.platform)) {
        action = "skip";
        reason = "source-breaker";
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
        }
      }

      const decision: Decision = { postId: post.id, platform: post.platform as string, action, reason };
      decisions.push(decision);
      return decision;
    };

    /* One refresh per connection per run. Two posts by the same creator can now
       be read at the same moment, and each would otherwise find the same
       expiring token and refresh it -- two exchanges, two writes, and the
       second write replacing a token the first read may still be using. */
    const tokenRefreshes = new Map<string, Promise<string | undefined>>();
    const refreshOnce = (key: string | undefined, refresh: () => Promise<string | undefined>) => {
      if (!key) return refresh();
      let pending = tokenRefreshes.get(key);
      if (!pending) {
        pending = refresh();
        tokenRefreshes.set(key, pending);
      }
      return pending;
    };

    const readPost = async (post: (typeof posts)[number]) => {
      const { action, reason } = claim(post);

      if (action === "skip") {
        if (reason === "budget") skippedForBudget++;
        return;
      }

      if (action === "seal") {
        /* A tracker whose window closed, or an old post's tracker that has had
           its reading (postCoverage). Each seal says which, because
           lib/sync/unsealMisfiredTtl keys on the TTL one. */
        try {
          await sealPost(post, sealSource(reason), now);
          sealed++;
        } catch (err) {
          log.error("failed to seal post", { postId: post.id, error: String(err) });
          failed++;
        }
        return;
      }

      try {
        /* A Facebook Login row only. An Instagram Login token is governed by
           graph.instagram.com, and the metrics walk below is graph.facebook.com,
           which rejects it — so handing it over bought a failed call and an
           "auth" reason on a post whose creator had connected fine. Without a
           Facebook Login row the post reads the way an unconnected creator's
           does. */
        const orgId = post.creator.orgId;
        const igRows = post.creator.socialAccounts.filter(
          (a) => a.platform === "INSTAGRAM" && !isInstagramLoginRow(a.origin),
        );
        const igAccount = igRows.find((a) => readable(orgId, a));
        const ttAccount = post.creator.socialAccounts.find(
          (a) => a.platform === "TIKTOK" && readable(orgId, a),
        );
        const instagramToken =
          post.platform === "INSTAGRAM"
            ? await refreshOnce(igAccount && `ig:${igAccount.id}`, () =>
                ensureFreshInstagramToken(igAccount, post.creator.orgId),
              )
            : undefined;
        const instagramHandle =
          post.platform === "INSTAGRAM"
            ? instagramLookupHandle({
                postUrl: post.postUrl,
                /* The handle is a lookup hint, not a read of the connection,
                   so an ungranted row still names whom to look up. */
                connected: igAccount?.handle ?? igRows[0]?.handle,
                profileLink: post.creator.profileLinks[0]?.handle,
                creatorHandle: post.creator.handle,
                creatorPlatform: post.creator.platform,
              })
            : undefined;
        const tiktokToken =
          post.platform === "TIKTOK"
            ? await refreshOnce(ttAccount && `tt:${ttAccount.id}`, () =>
                ensureFreshTikTokToken(ttAccount, post.creator.orgId),
              )
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
        if (!metrics) return;

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
        sourceGuard.record(post.platform, classifyPostRead(outcome), outcome.status === "measured" ? null : outcome.reason);

        if (outcome.status === "measured") {
          /* Stamped here, not when the request was spent: a campaign whose
             every post came back empty or threw was not refreshed, and its
             header must keep showing the last time it actually was. */
          sweptCampaigns.add(post.campaignId);
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
            if (post.platform === "INSTAGRAM") {
              instagramCredentialsRejected++;
              instagramRejectedSampleUrl ??= post.postUrl;
            }
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
            return;
          }
          const settled = SETTLED_REASONS.has(outcome.reason);
          const nextFailCount = settled ? MAX_SYNC_FAILURES : post.syncFailCount + 1;
          const failData: Record<string, unknown> = { syncFailCount: nextFailCount };
          if (nextFailCount >= MAX_SYNC_FAILURES) {
            failData.syncDisabledAt = now;
            deadLettered++;
            if (!settled) {
              unexplainedDeadLetters[outcome.reason] = (unexplainedDeadLetters[outcome.reason] ?? 0) + 1;
            }
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
    };

    if (dryRun) {
      for (const post of posts) claim(post);
    } else {
      /* Each platform drains its own queue with its own workers, all three at
         once. The loop this replaces read one post at a time across all of
         them, so a run's four minutes were spent waiting on one TikTok page
         after another while the pool's second lane sat idle, and it ended at
         the deadline every time (243.6s on 2026-10-02 18:00).

         Per platform rather than one shared pool, so that a slow source only
         slows itself: workers stuck behind paced TikTok lanes would otherwise
         hold up YouTube rows that are already in memory. The deadline is
         checked before every claim, and whatever a platform had not reached
         is counted as skippedForBudget, as before. */
      const sweep = async (queue: typeof posts, width: number) => {
        let next = 0;
        const worker = async () => {
          while (next < queue.length) {
            if (Date.now() > deadline) {
              skippedForBudget += queue.length - next;
              next = queue.length;
              return;
            }
            await readPost(queue[next++]);
          }
        };
        const workers = Math.min(Math.max(1, width), queue.length);
        await Promise.all(Array.from({ length: workers }, () => worker()));
      };
      await Promise.all(
        SWEEP_PLATFORMS.map((platform, i) =>
          sweep(
            byPlatform[i],
            platform === "TIKTOK" ? (tiktokSandbox?.size ?? 1) : (READ_CONCURRENCY[platform] ?? 1),
          ),
        ),
      );
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
      sealed, failed, deadLettered, unexplainedDeadLetters, skipped,
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
    /* An answer is not an outage. A post the platform says is gone, one that
       publishes no counters, or an account Instagram says shares nothing were
       all asked and answered. Counted here, 54 deletions paged at 80% on
       2026-09-24, and ~40 Instagram posts that no longer exist kept every run
       between 46% and 53% for the week after. */
    const answered = Object.entries(noCountReasons)
      .filter(([reason]) => ANSWERED_REASONS.has(reason as FetchReason))
      .reduce((sum, [, n]) => sum + n, 0);
    const unproductive = noCounts - answered + failed;
    if (shouldAlertOnBatch({ failed: unproductive, total: attempted })) {
      await alertOps({
        source: "cron/sync-posts",
        title: `Post metric sync returning nothing: ${unproductive}/${attempted} attempts`,
        severity: "critical",
        facts: {
          synced, sealed, failed, noCounts, answered, noCountReasons, deadLettered,
          skippedForBudget, attempted, total: posts.length,
        },
      });
    } else if (Object.keys(unexplainedDeadLetters).length > 0) {
      /* Dead-lettered posts stop syncing forever until someone intervenes, and
         these ones nobody explained -- which is also what a platform changing
         its page under us looks like, so it is worth a person's look. A post
         the platform said is gone is not: it dead-letters once, carries its
         pill, and on 2026-09-30 six of those were the whole of this mail. */
      const unexplained = Object.values(unexplainedDeadLetters).reduce((a, b) => a + b, 0);
      await alertOps({
        source: "cron/sync-posts",
        title: `${unexplained} post(s) stopped syncing after ${MAX_SYNC_FAILURES} reads with no numbers`,
        facts: { unexplained, byReason: unexplainedDeadLetters, deadLettered, failed, total: posts.length },
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
        samplePostUrl: instagramRejectedSampleUrl,
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
      candidatesByTier,
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
    if (!dryRun) await sourceGuard.flush();
  }
}

/* Kill switch and heartbeat around the handler above (lib/ops/cronRoute). */
export const GET = cronRoute("sync-posts", cronHandler);
