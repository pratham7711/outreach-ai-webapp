import { db } from "@/lib/db";
import { syncPost } from "@/lib/sync/syncPost";
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
const LANE_TARGET_SECONDS = 35;

/** Progress is for a human watching a spinner; a write per post would cost more
    than the fetch it reports on. */
const PROGRESS_EVERY = 5;

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
  const lanes = laneCountFor(tiktokPosts, LANE_TARGET_SECONDS);
  const tiktokSandbox = lanes > 0 ? openSandboxPostPool(lanes) : undefined;
  if (tiktokSandbox) {
    log.info("sandbox pool opened", { lanes, tiktokPosts });
  }

  const deadline = Date.now() + DEADLINE_MS;
  let measured = 0;
  let noMetrics = 0;
  let unfetchable = 0;
  let failed = 0;
  let completed = 0;
  const reasons: Record<string, number> = {};
  const note = (reason: string) => {
    reasons[reason] = (reasons[reason] ?? 0) + 1;
  };

  try {
    let next = 0;
    let lastWritten = 0;
    const worker = async () => {
      while (next < posts.length) {
        if (Date.now() > deadline) return;
        const post = posts[next++];
        try {
          /* countsOnly: this run exists to move numbers. Spending a paced slot
             on a metadata-only fallback costs the post behind it its turn. */
          const outcome = await syncPost(post, orgId, { countsOnly: true, tiktokSandbox });
          if (outcome.status === "measured") measured++;
          else if (outcome.status === "no-metrics") {
            noMetrics++;
            note(outcome.reason);
          } else {
            unfetchable++;
            note(outcome.reason);
          }
        } catch (error) {
          // One bad post does not abandon the rest of the campaign.
          failed++;
          note("error");
          log.error("post refresh failed", {
            postId: post.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        completed++;

        if (completed - lastWritten >= PROGRESS_EVERY) {
          lastWritten = completed;
          await db.campaignRefreshRun
            .update({
              where: { id: run.id },
              data: { completed, measured, noMetrics, unfetchable, failed },
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
      posts.length,
    );
    await Promise.all(Array.from({ length: workers }, () => worker()));

    // Counted from what finished rather than from the cursor, so a post claimed
    // as the deadline passed is reported as left over, not as done.
    const remaining = posts.length - (measured + noMetrics + unfetchable + failed);
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
