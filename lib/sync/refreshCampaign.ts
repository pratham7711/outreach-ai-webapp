import { db } from "@/lib/db";
import { syncPost } from "@/lib/sync/syncPost";
import type { FetchReason } from "@/lib/platforms/fetchPostMetrics";
import { openTikTokPostFetcher } from "@/lib/platforms/tiktokEgress";
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
  /* Our clock, not their answer. A second attempt costs one more walk and
     frequently succeeds, because the usual cause is a single slow page rather
     than Meta being unreachable. */
  "reader-timeout": true,
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

/**
 * How long one refresh may keep continuing across fresh invocations.
 *
 * THE POINT OF THIS WHOLE MECHANISM. Three rounds inside one 260s function is
 * not "refresh every post", it is "try hard for four minutes" -- and measured
 * on prod, a 58-post refresh came back 27 measured / 15 backing-off / 13
 * refused. The 31 that missed were not bad posts; they were posts whose turn
 * arrived while a lane was walled. The run then ended and nothing ever went
 * back for them, so the campaign showed stale numbers with no indication that
 * anything was outstanding.
 *
 * A single invocation cannot fix that, because the wall is probabilistic and
 * the function has a hard ceiling. What fixes it is making the run RESUMABLE:
 * when the window closes with retryable posts left, the run stays open and a
 * fresh invocation picks up exactly those posts, with a fresh time budget and
 * -- crucially -- fresh egress identities, which is the thing that actually
 * changes the odds.
 *
 * Twenty minutes is roughly five windows. At the measured ~47% per-window pass
 * rate, a post surviving five independent windows unmeasured has probability
 * 0.53^5 = 4%; with proxies raising the per-window rate the tail collapses
 * further. It is a bound, not a promise: the alternative to a bound is a
 * refresh that can spin forever against a WAF that has simply decided no.
 */
const MAX_REFRESH_WALL_MS = 20 * 60 * 1000;

/**
 * The second bound, and the one that actually stops a runaway.
 *
 * MAX_REFRESH_WALL_MS bounds how LONG the chain may run; it does not bound how
 * MANY windows fit inside that. Nothing puts a floor under a window: measured
 * with every post failing retryably, a 100-post window returns in 2ms with
 * continuing=true. Real failures involve a paced network attempt, so that is
 * not the normal shape -- but a dead pool, a DNS failure, an immediately
 * refused connection or simply a bug all produce fast failures, and against
 * those the wall alone permits hundreds of self-POSTs in twenty minutes
 * instead of four.
 *
 * So the count is bounded too. Four full-length windows fill the wall
 * (20min / 300s), which makes six generous for the honest case and binding
 * only for the degenerate one -- exactly where a bound is wanted.
 */
const MAX_REFRESH_WINDOWS = 6;

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
  /** Posts still worth another window. Zero means the run is genuinely done. */
  continuable: number;
  /** Whether a fresh invocation should be started for those posts. */
  continuing: boolean;
  /** Which window this was, 1-based. The route passes it to the next one so
   *  the chain can count itself without a column to store the count in. */
  window: number;
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
  /**
   * Continue an existing run in a fresh invocation, rather than starting one.
   *
   * The caller is the refresh route handing the baton to itself. A continuation
   * is the SAME run: same id, same startedAt, same cooldown window -- so it must
   * not re-check the cooldown (its own parent run would fail it) and must not
   * create a second row.
   */
  resumeRunId?: string;
  /**
   * Which window of the chain this is, 1-based. Supplied only by the route
   * handing the baton to itself, on the branch that already proved it holds
   * CRON_SECRET -- so it cannot be forged by an outside caller to buy extra
   * windows, and an outside caller cannot reach the continuation path at all.
   */
  window?: number;
}): Promise<RefreshOutcome> {
  const { orgId, campaignId, userId, resumeRunId } = input;
  /* Clamped, not trusted: a malformed or hostile value must shorten the chain
     or leave it unchanged, never extend it. */
  const window =
    Number.isFinite(input.window) && (input.window as number) >= 1
      ? Math.min(Math.floor(input.window as number), MAX_REFRESH_WINDOWS)
      : 1;
  const log = createLogger({ context: { op: "refreshCampaign", campaignId } });

  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, orgId, deletedAt: null },
    select: { id: true, song: { select: { soundId: true } } },
  });
  if (!campaign) return { ok: false, reason: "not-found" };

  /* Scoped by orgId and campaignId, not just by id: the run id arrives from an
     HTTP call, and a run belonging to another org must not be resumable by
     naming it. */
  const resuming = resumeRunId
    ? await db.campaignRefreshRun.findFirst({
        where: { id: resumeRunId, orgId, campaignId },
        select: { id: true, startedAt: true, total: true, status: true },
      })
    : null;
  if (resumeRunId && !resuming) return { ok: false, reason: "not-found" };

  if (!resuming) {
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
  }

  const posts = await db.post.findMany({
    where: {
      campaignId,
      /* The leftover set, derived rather than stored.
       *
       * syncPost stamps lastSyncedAt ONLY when counts actually came back, so
       * "not measured by this run" is exactly "lastSyncedAt is null, or older
       * than the moment this run started". That makes the resume set a query
       * instead of a column, which matters three ways: no schema change to ship
       * (the TTL DDL is still unapplied on prod), the set self-heals if the cron
       * measures a post between windows, and a continuation can never re-read a
       * post that already succeeded. */
      ...(resuming
        ? {
            OR: [
              { lastSyncedAt: null },
              { lastSyncedAt: { lt: resuming.startedAt } },
            ],
          }
        : {}),
    },
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

  const run =
    resuming ??
    (await db.campaignRefreshRun.create({
      data: { orgId, campaignId, userId, total: posts.length, status: "running" },
      select: { id: true, startedAt: true, total: true, status: true },
    }));

  /* Progress must keep counting up across windows, not restart at zero.
     On a continuation the leftovers ARE the unmeasured posts, so everything
     else in the run's original total is already measured -- which makes the
     carried-forward counts derivable, with nothing extra to store or to drift. */
  const alreadyMeasured = resuming ? Math.max(0, resuming.total - posts.length) : 0;
  const runTotal = run.total;

  if (resuming) {
    log.info("continuing an unfinished refresh", {
      runId: run.id,
      leftover: posts.length,
      alreadyMeasured,
      windowMs: Date.now() - run.startedAt.getTime(),
    });
  }

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
  /* Which KIND of egress this is depends on whether proxies are configured;
     the sizing above is the sandbox's, which openTikTokPostFetcher applies to
     whichever pool it ends up opening. A person is waiting on this run, so
     unlike the cron it takes the full lane count. */
  const tiktokSandbox = openTikTokPostFetcher(tiktokPosts);
  if (tiktokSandbox) {
    log.info("tiktok egress opened", { lanes: tiktokSandbox.size, tiktokPosts });
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
                data: {
                  /* Carried forward, so "N of M" keeps rising across windows
                     instead of snapping back to zero when a continuation
                     starts -- which would read as the refresh losing work. */
                  completed: alreadyMeasured + results.size,
                  measured: alreadyMeasured + measured,
                  noMetrics, unfetchable, failed,
                },
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

    /* What is still worth another window, decided exactly as the in-run retry
       decides it. A settled reason -- deleted, unrecognised URL, no counts
       published -- is never continuable: re-asking across twenty minutes gets
       the same settled answer it got in the first four, and the whole point of
       REASON_IS_RETRYABLE is that the distinction is already made honestly. */
    const continuable = posts.filter((post) => {
      const r = results.get(post.id);
      if (!r) return true; // the deadline arrived before its turn did
      if (r.status === "measured") return false;
      return REASON_IS_RETRYABLE[r.reason];
    }).length;

    const wallElapsedMs = Date.now() - run.startedAt.getTime();
    /* Both bounds must hold. They fail in different ways on purpose: the wall
       catches a chain that is slow, the count catches one that is fast. */
    const continuing =
      continuable > 0 &&
      wallElapsedMs < MAX_REFRESH_WALL_MS &&
      window < MAX_REFRESH_WINDOWS;

    if (continuable > 0 && !continuing) {
      /* The bound was reached with posts still unmeasured. Said plainly, because
         the alternative -- reporting "done" -- is how a refresh that quietly
         measured 70 of 100 looks identical to one that measured all 100. */
      log.warn("refresh bound reached with posts still unmeasured", {
        runId: run.id, continuable, wallElapsedMs, total: runTotal, window,
        bound: window >= MAX_REFRESH_WINDOWS ? "window-count" : "wall-clock",
      });
    }

    await db.campaignRefreshRun.update({
      where: { id: run.id },
      data: {
        status: continuing ? "continuing" : "done",
        completed: alreadyMeasured + completed,
        measured: alreadyMeasured + measured,
        noMetrics, unfetchable, failed,
        remaining: Math.max(0, runTotal - (alreadyMeasured + completed)),
        reasons,
        /* Left null while continuing: finishedAt is what the button reads to
           stop spinning, and a run with another window coming has not finished. */
        finishedAt: continuing ? null : new Date(),
      },
    });

    return {
      ok: true,
      result: {
        runId: run.id,
        total: runTotal,
        measured: alreadyMeasured + measured,
        noMetrics, unfetchable, failed,
        remaining: Math.max(0, runTotal - (alreadyMeasured + completed)),
        reasons, sound,
        nextRefreshAt: new Date(run.startedAt.getTime() + REFRESH_COOLDOWN_MS).toISOString(),
        continuable,
        continuing,
        window,
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
