import { db } from "@/lib/db";
import { syncPost } from "@/lib/sync/syncPost";
import type { FetchReason } from "@/lib/platforms/fetchPostMetrics";
import { laneCountFor, openSandboxPostPool } from "@/lib/platforms/tiktokPostSandbox";
import { snapshotSounds } from "@/lib/sounds/snapshot";
import { createLogger } from "@/lib/observability/logger";
import {
  REFRESH_COOLDOWN_MS,
  cooldownStateFrom,
  tooSoonMessage,
  type CooldownState,
} from "@/lib/refreshCooldown";

/**
 * Refresh every post on a campaign, and the sound it tracks.
 *
 * The operation lives here rather than in the route because the route is not
 * the only way in: the MCP server can drive the same work on behalf of an
 * agent, and a cooldown enforced in one HTTP handler is not a cooldown -- an
 * agent would spend the campaign's whole allowance while the button politely
 * waited its turn. TikTok is rationing us either way and does not care which of
 * our callers it was. So the gate is checked HERE, inside the operation, and
 * every caller inherits it by construction rather than by remembering to ask.
 */

/** Leaves room to write the run record and a response after the loop stops. */
const DEADLINE_MS = 260 * 1000;

/**
 * How many posts are in flight at once, when there is no sandbox pool to match.
 *
 * These are idle waits, so overlapping them costs nothing but the burst -- and
 * the per-host gate in fetchPostMetrics paces the actual outbound requests
 * regardless, so this widens the pipeline without widening what TikTok sees.
 *
 * With a pool, concurrency tracks the number of lanes instead: each lane paces
 * its own address, so a fifth worker against four lanes just queues behind a
 * gate. Matching the two is what turns extra lanes into extra throughput.
 */
const CONCURRENCY = 4;

/**
 * What a refresh should FEEL like, not what it is allowed to get away with.
 * Lanes are sized toward this; the 260s deadline remains the hard ceiling.
 *
 * The number comes from the product we are being compared against. CreatorCore
 * refreshed the same PARA PARA campaign -- 118 posts on their side -- in about
 * 66 seconds, measured 2026-09-02: 20 done at 23s, 50 at 34s, 92 at 54s, 111 at
 * 62s. That is a steady 2.33 posts/sec, roughly four of our lanes' worth.
 *
 * 35s rather than a rounder number because beating a RATE needs a minimum lane
 * count, not merely a time target: at 45s an 88-post campaign rounded down to
 * four lanes and finished in 39.6s, losing to their 37.8s. 35s clears them at
 * every campaign size we actually hold.
 *
 * Small campaigns are the exception and deliberately not lane-heavy. Under
 * ~60 posts CreatorCore is faster, because our per-address pace is a fixed
 * floor and booting sandboxes to beat a twenty-post refresh would cost more in
 * boot latency than the work itself. Note that boot cost is NOT modelled here
 * at all -- these numbers are the paced work only, so small pools are the ones
 * where reality will lag the arithmetic.
 */
/* Kept for reference only; sizing moved into laneCountFor so the environment
   variable that was always meant to control it actually does. */

/** Progress is for a human watching a spinner; a write per post would cost more
    than the fetch it reports on. */
const PROGRESS_EVERY = 5;

/**
 * Which failures are worth asking again about.
 *
 * The distinction is between an answer about the POST and an answer about the
 * MOMENT. A wall, a latched breaker, a 429, a thrown request -- those say
 * something about the address we asked from and when; a different lane a few
 * seconds later frequently gets the page. That is the entire reason a run can
 * measure 80 of 88 and find nothing wrong with the other eight.
 *
 * Everything NOT listed here is settled and must never be retried, which is the
 * half that keeps this bounded: "post-deleted" and "unrecognised-url" would
 * return the identical answer from every address forever, and a retry loop that
 * cannot tell those apart from a wall is a loop that never ends. Absent by
 * design: post-deleted, no-counts-published, unrecognised-url, not-configured.
 */
/**
 * Every FetchReason, classified as worth another sweep or not.
 *
 * A total Record over the union rather than a Set of strings, and that is the
 * point: adding a reason to FetchReason without deciding this now fails to
 * compile. The Set it replaced could not do that -- it silently defaulted any
 * unlisted reason to "settled, never retry", which is the more damaging of the
 * two answers, and it carried an "error" entry that is not a member of the
 * union at all and therefore matched nothing.
 *
 * Retryable means the obstacle is about the moment or about us: a WAF
 * challenge, a refusal, a shut gate, an unexplained empty. Settled means a
 * platform stated something positive about the post, or the deployment is
 * missing a key that three sweeps in one minute will not conjure.
 */
/**
 * Every reason a post can leave a sweep unmeasured.
 *
 * FetchReason plus "error", which is deliberately not one: a FetchReason is
 * something a platform told us, and "error" is our own code throwing. Folding
 * it into platform-refused would read as TikTok saying no when in fact we
 * never got a coherent answer out of our own call -- a distinction worth
 * keeping in the logs and in the debug breakdown.
 */
export type RefreshFailReason = FetchReason | "error";

const REASON_IS_RETRYABLE: Record<RefreshFailReason, boolean> = {
  "platform-challenged": true,
  /* Our lanes died, so the question was never asked. The most worth retrying
     of anything on this list: a later round gets a fresh sandbox, which is a
     fresh address. */
  "reader-unavailable": true,
  "backing-off": true,
  "platform-refused": true,
  /* An empty answer with no reason attached. Retryable because we cannot show
     it is settled: a settled reason is something a fetcher states positively,
     and silence is not one of them. */
  unknown: true,
  "post-deleted": false,
  "unrecognised-url": false,
  "no-counts-published": false,
  /* Three sweeps inside one request will not make the key appear. */
  "not-configured": false,
  /* Settled for THIS request only, and for the same reason as the line above:
     re-asking inside one sweep spends the budget on a credential that cannot
     revive before the response goes out. It is deliberately absent from the
     cron route's SETTLED_REASONS, because across runs it is very much
     retryable -- the moment a creator reconnects, the post reads again. */
  "credentials-rejected": false,
  // Our bug, not their verdict -- and a thrown call is often transient.
  error: true,
};

/**
 * A hard cap on sweeps, on top of the queue-must-shrink rule.
 *
 * Three because the value is almost entirely in the second pass -- it re-asks
 * from lanes that were not the ones that failed -- and a third only mops up
 * posts whose lane latched mid-run. A fourth has nothing left to route around,
 * and every round is deadline the next campaign's refresh is waiting on.
 */
const MAX_ROUNDS = 3;

export type RefreshTally = {
  runId: string;
  total: number;
  measured: number;
  noMetrics: number;
  unfetchable: number;
  failed: number;
  remaining: number;
  reasons: Record<string, number>;
  sound: unknown;
  nextRefreshAt: string;
};

export type RefreshOutcome =
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "cooldown"; message: string; state: CooldownState }
  | { ok: true; result: RefreshTally };

/** The cooldown answer on its own, for callers that only want to display it. */
export async function getRefreshCooldown(
  orgId: string,
  campaignId: string,
): Promise<CooldownState | null> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, orgId, deletedAt: null },
    select: { id: true },
  });
  if (!campaign) return null;

  const latest = await db.campaignRefreshRun.findFirst({
    where: { campaignId },
    orderBy: { startedAt: "desc" },
  });
  return cooldownStateFrom(latest);
}

export async function refreshCampaign(input: {
  orgId: string;
  campaignId: string;
  userId?: string;
}): Promise<RefreshOutcome> {
  const { orgId, campaignId, userId } = input;
  const log = createLogger({ context: { op: "refreshCampaign", campaignId } });

  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, orgId, deletedAt: null },
    select: { id: true, song: { select: { soundId: true } } },
  });
  if (!campaign) return { ok: false, reason: "not-found" };

  const latest = await db.campaignRefreshRun.findFirst({
    where: { campaignId },
    orderBy: { startedAt: "desc" },
  });
  const state = cooldownStateFrom(latest);
  if (!state.canRefresh) {
    return {
      ok: false,
      reason: "cooldown",
      message: tooSoonMessage(state.retryAfterSeconds),
      state,
    };
  }

  const posts = await db.post.findMany({
    where: { campaignId },
    // platformMetrics comes along because applyPostMetrics merges the measured-field
    // record into it rather than replacing the importer's raw record.
    select: {
      id: true, platform: true, creatorId: true, postUrl: true,
      thumbnailUrl: true, caption: true, platformMetrics: true,
    },
    // Oldest sync first, so a campaign too big for one run still makes
    // progress on the stalest posts each time.
    orderBy: { lastSyncedAt: { sort: "asc", nulls: "first" } },
  });

  const run = await db.campaignRefreshRun.create({
    data: { orgId, campaignId, userId, total: posts.length, status: "running" },
    select: { id: true },
  });

  /* TikTok refuses this project's function egress far more often than it
     answers it, and answers a sandbox every time -- so the run reads through
     one sandbox rather than paying the WAF three times in four. Opened for the
     whole run and closed in the finally below; it boots lazily, so a campaign
     with no TikTok posts never pays for it. */
  /* Sized from the work rather than fixed. Every sandbox gets its own egress
     IP (measured: five sandboxes, five addresses, three of them in one region),
     so lanes are capacity, not a queue -- and a 492-post campaign that could
     never finish in one run on a single lane finishes on six. */
  const tiktokPosts = posts.filter((p) => p.platform === "TIKTOK").length;
  /* No target passed on purpose. Handing laneCountFor a hardcoded 35 overrode
     its own env-aware default, so TIKTOK_SANDBOX_TARGET_SECONDS was dead for
     the only code path that opens a pool -- the knob existed and tuned
     nothing. Sizing now lives in one place, where it can be tuned without a
     deploy. */
  const lanes = laneCountFor(tiktokPosts);
  const tiktokSandbox = lanes > 0 ? openSandboxPostPool(lanes) : undefined;
  if (tiktokSandbox) {
    log.info("sandbox pool opened", { lanes, tiktokPosts });
  }

  const deadline = Date.now() + DEADLINE_MS;

  /* One entry per post, overwritten rather than appended to.
     A post that is walled in round one and measured in round two is ONE post
     with one outcome, and the counters used to be incremented per attempt --
     which with retries in play would report 94 results for 88 posts and a
     "measured" count the totals do not add up to. The map is what makes the
     summary a statement about posts instead of about attempts. */
  type PostResult =
    | { status: "measured" }
    | { status: "no-metrics"; reason: RefreshFailReason }
    | { status: "unfetchable"; reason: RefreshFailReason }
    | { status: "failed"; reason: RefreshFailReason };
  const results = new Map<string, PostResult>();

  const tally = () => {
    let measured = 0;
    let noMetrics = 0;
    let unfetchable = 0;
    let failed = 0;
    const reasons: Record<string, number> = {};
    for (const r of results.values()) {
      if (r.status === "measured") {
        measured++;
        continue;
      }
      if (r.status === "no-metrics") noMetrics++;
      else if (r.status === "unfetchable") unfetchable++;
      else failed++;
      reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    }
    return { measured, noMetrics, unfetchable, failed, reasons };
  };

  try {
    let sinceWrite = 0;

    const runPass = async (batch: typeof posts) => {
      let next = 0;
      const worker = async () => {
        while (next < batch.length) {
          if (Date.now() > deadline) return;
          const post = batch[next++];
          let result: PostResult;
          try {
            /* countsOnly: this run exists to move numbers. Spending a paced slot
               on a metadata-only fallback costs the post behind it its turn. */
            const outcome = await syncPost(post, orgId, { countsOnly: true, tiktokSandbox });
            result =
              outcome.status === "measured"
                ? { status: "measured" }
                : { status: outcome.status, reason: outcome.reason };
          } catch (error) {
            // One bad post does not abandon the rest of the campaign.
            result = { status: "failed", reason: "error" };
            log.error("post refresh failed", {
              postId: post.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
          results.set(post.id, result);

          /* One line per post that did not come back with numbers, carrying the
             post's identity and the cause together.
             
             Until this existed the platform logs held the cause and the run
             record held the count, and nothing held both -- so "41 of 62
             updated" could not be turned into "these 21, for this reason"
             without reading the whole log by hand and guessing which line
             belonged to which post. One line per FAILURE, never per attempt and
             never per success: a 500-post campaign that works logs nothing here
             at all, and a campaign that fails logs exactly as many lines as
             there are problems to fix. */
          if (result.status !== "measured") {
            log.warn("post left unmeasured", {
              postId: post.id,
              platform: post.platform,
              postUrl: post.postUrl,
              reason: result.reason,
              outcome: result.status,
            });
          }

          /* Counted in attempts, not in map size, so the later rounds report
             progress too -- their whole job is to move posts from unmeasured to
             measured without the completed count changing at all. */
          if (++sinceWrite >= PROGRESS_EVERY) {
            sinceWrite = 0;
            const { measured, noMetrics, unfetchable, failed } = tally();
            await db.campaignRefreshRun
              .update({
                where: { id: run.id },
                data: { completed: results.size, measured, noMetrics, unfetchable, failed },
              })
              .catch(() => {
                /* Progress is a nicety. Losing a tick must not lose the run. */
              });
          }
        }
      };
      /* One worker per lane, so every lane is busy and none is contended. Without
         a pool this falls back to the fixed concurrency. */
      const workers = Math.min(
        Math.max(CONCURRENCY, tiktokSandbox?.size ?? 0),
        batch.length,
      );
      await Promise.all(Array.from({ length: workers }, () => worker()));
    };

    /* Sweep the campaign, then sweep what the first sweep could not measure.
     *
     * A refusal is mostly a fact about a moment and an address, not about the
     * post: the run that measured 80 of 88 did not find eight bad posts, it
     * found eight posts whose turn came up while a lane was walled or its
     * breaker was latched. Those are exactly the ones a later pass gets, because
     * by then the pool is routing around the lane that failed them.
     *
     * The termination argument, which matters more than the retry:
     *   - the queue is rebuilt each round from the previous round's failures, so
     *     it can only shrink;
     *   - a round that shrinks it by nothing ends the loop, because every lane
     *     is walled or latched and asking the same wall again only spends the
     *     deadline;
     *   - only transient reasons are eligible at all, so a deleted post leaves
     *     the queue after its first answer and never returns;
     *   - MAX_ROUNDS caps it regardless;
     *   - and every worker re-checks the deadline before claiming a post.
     * Any one of those alone terminates. "Retry until it works" against a WAF
     * is how a refresh becomes an infinite loop, and none of these depend on
     * TikTok eventually cooperating. */
    let queue = posts;
    for (let round = 1; round <= MAX_ROUNDS && queue.length > 0; round++) {
      if (Date.now() > deadline) break;
      if (round > 1) {
        log.info("retrying what a transient refusal left unmeasured", {
          round,
          posts: queue.length,
        });
      }

      await runPass(queue);

      const again = queue.filter((post) => {
        const r = results.get(post.id);
        if (!r) return true; // never got its turn before the deadline
        if (r.status === "measured") return false;
        return REASON_IS_RETRYABLE[r.reason];
      });
      if (again.length >= queue.length) break;
      queue = again;
    }

    const { measured, noMetrics, unfetchable, failed, reasons } = tally();
    const completed = results.size;

    // Counted from what finished rather than from the cursor, so a post claimed
    // as the deadline passed is reported as left over, not as done.
    const remaining = posts.length - completed;
    if (remaining > 0) log.warn("time budget reached; stopping early", { remaining });

    // The campaign's audio is part of "the campaign's data", and it comes from
    // the same blocked-or-not TikTok as the posts, so it belongs in this run.
    const soundId = campaign.song?.soundId ?? null;
    const sound = soundId
      ? await snapshotSounds({ orgId, soundId, deadlineMs: 15 * 1000 })
      : null;

    /* One line carrying the whole shape of the run. Until this existed the only
       way to learn why a refresh did nothing was to read the platform logs a
       line at a time and count them by hand. */
    log.info("campaign refresh finished", {
      total: posts.length, measured, noMetrics, unfetchable, failed, remaining, reasons,
    });

    await db.campaignRefreshRun.update({
      where: { id: run.id },
      data: {
        status: "done",
        completed, measured, noMetrics, unfetchable, failed, remaining, reasons,
        finishedAt: new Date(),
      },
    });

    return {
      ok: true,
      result: {
        runId: run.id,
        total: posts.length,
        measured, noMetrics, unfetchable, failed, remaining, reasons, sound,
        nextRefreshAt: new Date(Date.now() + REFRESH_COOLDOWN_MS).toISOString(),
      },
    };
  } catch (error) {
    /* The run row must not be left saying "running" forever -- the button reads
       it to decide whether to keep spinning. */
    await db.campaignRefreshRun
      .update({ where: { id: run.id }, data: { status: "failed", finishedAt: new Date() } })
      .catch(() => {});
    throw error;
  } finally {
    /* Billed by lifetime, so leaving one running past the run costs real money
       on every refresh. Closed here rather than after the success return so a
       thrown run does not leak one. */
    await tiktokSandbox?.close();
  }
}
