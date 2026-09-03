import { Sandbox } from "@vercel/sandbox";
import { createLogger } from "@/lib/observability/logger";
import { createRateGate, readTikTokPostHtml, type TikTokPostLookup } from "./fetchPostMetrics";

/**
 * Post metrics, fetched from egresses TikTok actually answers -- several at
 * once.
 *
 * The measured facts, both from PARA PARA posts:
 *
 *  - TikTok's WAF serves this project's function egress (sin1) a ~1.4KB Slardar
 *    login shell for video-detail pages roughly three times in four, while a
 *    plain curl from a Vercel Sandbox returns the full ~390KB server-rendered
 *    page. Eight of eight, 2026-09-02.
 *  - Every sandbox gets its own egress IP, including several booted in the SAME
 *    region: iad1 gave 100.27.222.94, 44.213.125.175 and 54.90.253.5, sfo1 and
 *    cdg1 two more. Five sandboxes, five distinct addresses.
 *
 * The second fact is what makes this a pool rather than a rate limiter. TikTok
 * refuses on identity, not on volume, so throughput is bounded by how many
 * credible egress identities we hold -- not by how slowly we ask from one. Ten
 * lanes at a polite pace is ten times the capacity of one lane at ten times the
 * pace, and it is also the safer of the two, because each address keeps the
 * low-volume profile that works today. Rationing a single lane would have
 * capped the product's growth to protect a limit that was never the problem.
 *
 * So each lane carries its own gate. The pacing is per identity, deliberately:
 * it is politeness toward one address, not a budget shared across the fleet.
 *
 * Cost is close to a wash. Sandboxes bill by lifetime, and parallelising does
 * not change the work -- 88 posts is ~154 sandbox-seconds on one lane and ~160
 * across four, for a quarter of the wall clock.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Comfortably longer than the refresh deadline; the run closes lanes first. */
const SANDBOX_LIFETIME_MS = 5 * 60 * 1000;

/* Sandbox regions are limited to these four -- notably no sin1. Lanes are
   spread across them so a region-wide block cannot take the whole pool, and
   because it widens the address diversity further. */
const REGIONS = ["iad1", "sfo1", "cle1", "cdg1"] as const;

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Per-lane pace. One address asking this often is the profile that works. */
export const LANE_SECONDS_PER_POST = 1.8;

/**
 * How many lanes to open for a given amount of work.
 *
 * Sized toward a target completion time, NOT merely to fit inside the run's
 * deadline. Those give very different answers and the difference is the point:
 * fitting the deadline put 88 posts on one lane for 154s, because 154 is less
 * than the budget and nothing asked for better. Lanes are independent capacity
 * -- separate sandboxes hold separate egress IPs -- so leaving them unopened
 * buys nothing except a slower refresh.
 *
 * The pace per lane stays where the evidence is. One IP has been observed
 * serving 88 sustained requests at this cadence with zero challenges; nothing
 * has established a safe floor below it, so throughput comes from opening more
 * addresses rather than leaning harder on one.
 */
/* 15s, down from 35s.
 *
 * The target is really a lever on how many ADDRESSES a run holds, and 35 sized
 * a 58-post refresh at three lanes -- ~19 requests per egress IP, and the same
 * three IPs reused by all three of refreshCampaign's retry sweeps, because the
 * pool is opened once for the whole run. A post's attempt budget is 3, so its
 * retries spent every address the run had; and pick() skips a lane whose
 * breaker has latched, so a few challenges removed the whole capacity at once.
 * 15 of 58 posts came back walled against a design expecting about 4%.
 *
 * At 15s the same refresh opens seven lanes: ~8 requests per address, each
 * keeping the low-volume profile TikTok tolerates. Total sandbox-seconds are
 * close to unchanged -- lanes are closed with the run, so the same work is
 * spread wider rather than held longer. */
export function laneCountFor(
  postCount: number,
  targetSeconds: number = envInt("TIKTOK_SANDBOX_TARGET_SECONDS", 15),
): number {
  const maxLanes = envInt("TIKTOK_SANDBOX_MAX_LANES", 8);
  if (postCount <= 0) return 0;
  const needed = Math.ceil((postCount * LANE_SECONDS_PER_POST) / Math.max(1, targetSeconds));
  return Math.max(1, Math.min(maxLanes, needed));
}

export type SandboxPostFetcher = {
  /** Null means this lane failed, not that the post is unreadable -- the caller
   *  falls back to the direct fetch rather than reporting a verdict it did not
   *  actually get from TikTok. */
  readPost: (url: string) => Promise<TikTokPostLookup | null>;
  close: () => Promise<void>;
  /** Lanes actually opened. Callers match their concurrency to this. */
  readonly size: number;
};

type Lane = {
  /** Changes when the lane is replaced: a fresh sandbox is a fresh ADDRESS, so
   *  a post that was walled on lane-0 must be allowed to try lane-0#2. The
   *  per-post `tried` set is keyed on this. */
  label: string;
  region: string;
  gate: ReturnType<typeof createRateGate>;
  sandbox: Promise<Sandbox> | null;
  /** This lane is done for the run: it could not boot. Others carry on. */
  dead: boolean;
  /** How many times this slot has been re-addressed. Bounds the churn. */
  generation: number;
  /** Index into REGIONS, advanced on replacement so a region-wide block does
   *  not simply reproduce itself. */
  regionIndex: number;
};

export function openSandboxPostPool(size: number): SandboxPostFetcher {
  const log = createLogger({ context: { platform: "TIKTOK", via: "sandbox-pool" } });
  const laneCount = Math.max(0, size);
  /* How many different addresses one post is worth before we accept the answer.
     Three because the wall is probabilistic per address, not per post: at the
     ~25% pass rate the direct egress sees, three independent addresses miss
     together about 4% of the time, and each extra attempt costs a paced slot
     that another post is waiting for. */
  const maxAttempts = envInt("TIKTOK_SANDBOX_MAX_ATTEMPTS", 3);

  /* Its own gate, and not shared with the direct fetch's tiktokGate: those are
     two different identities, and one breaker across both would let either
     silence the other. Same reasoning separates the lanes from each other. */
  const newGate = () =>
    createRateGate({
      minGapMs: envInt("TIKTOK_SANDBOX_MIN_GAP_MS", 1500),
      jitterMs: envInt("TIKTOK_SANDBOX_JITTER_MS", 600),
      breakerThreshold: envInt("TIKTOK_SANDBOX_BREAKER_THRESHOLD", 5),
      breakerCooldownMs: envInt("TIKTOK_SANDBOX_BREAKER_COOLDOWN_MS", 10 * 60 * 1000),
      challengeThreshold: envInt("TIKTOK_SANDBOX_CHALLENGE_THRESHOLD", 10),
      challengeCooldownMs: envInt("TIKTOK_SANDBOX_CHALLENGE_COOLDOWN_MS", 5 * 60 * 1000),
    });

  const lanes: Lane[] = Array.from({ length: laneCount }, (_, i) => ({
    label: `lane-${i}`,
    region: REGIONS[i % REGIONS.length],
    gate: newGate(),
    sandbox: null,
    dead: false,
    generation: 1,
    regionIndex: i,
  }));

  /**
   * Replacing a burned lane, rather than writing it off for the run.
   *
   * This is the fix for a measured production failure: a 58-post refresh
   * reported 27 measured, 15 "skipped while backing off", 13 refused. The
   * backing-off fifteen were never asked about at all.
   *
   * The cause is a mismatch of timescales. A latched gate stays shut for its
   * cooldown -- 10 minutes for the breaker, 5 for challenges -- and the whole
   * refresh has a 260-second deadline. So "backing off" inside one run does not
   * mean "wait and retry", it means "this lane is gone", and pick() then had
   * fewer and fewer addresses to offer until posts fell through to the direct
   * function egress, whose own gate promptly latched too. The retry sweeps could
   * not help: they re-entered the same pool holding the same burned addresses.
   *
   * But a cooldown is a statement about ONE IP, and every sandbox gets its own.
   * Stopping the sandbox and booting another is a brand-new address with a clean
   * gate -- which is the thing the cooldown was waiting for, obtained in a few
   * seconds instead of ten minutes.
   *
   * Bounded, because "boot until it works" against a WAF is how a refresh turns
   * into a bill: a per-run replacement budget, and the region advances each time
   * so a region-wide block does not just reproduce itself.
   */
  const maxReplacements = envInt("TIKTOK_SANDBOX_MAX_REPLACEMENTS", laneCount * 2);
  let replacements = 0;

  const replaceLane = (lane: Lane): boolean => {
    if (replacements >= maxReplacements) return false;
    replacements += 1;

    const spent = lane.sandbox;
    lane.sandbox = null;
    // Not awaited: the run should not pay the teardown before it can ask again.
    if (spent) spent.then((sb) => sb.delete({ deleteOrphanSnapshots: true })).catch(() => {});

    lane.generation += 1;
    lane.regionIndex += laneCount;
    lane.region = REGIONS[lane.regionIndex % REGIONS.length];
    /* A NEW label, so the per-post `tried` set does not refuse the fresh
       address as though it were the one that just walled the post. */
    lane.label = `lane-${lane.label.split("#")[0].replace("lane-", "")}#${lane.generation}`;
    lane.gate = newGate();
    lane.dead = false;

    log.warn("lane burned; replacing it with a fresh address", {
      lane: lane.label,
      region: lane.region,
      replacementsUsed: replacements,
      budget: maxReplacements,
    });
    return true;
  };

  let cursor = 0;

  const boot = (lane: Lane) => {
    if (!lane.sandbox) {
      lane.sandbox = Sandbox.create({
        region: lane.region as any,
        timeout: SANDBOX_LIFETIME_MS,
        // See tiktokProfileSandbox: a stop with persistence on snapshots the
        // whole 642MB filesystem and bills it for 30 days. Lanes are replaced
        // aggressively, so this is the single largest storage line if left on.
        persistent: false,
      });
      lane.sandbox.catch(() => {
        lane.sandbox = null;
      });
    }
    return lane.sandbox;
  };

  /** Round robin, skipping lanes that are dead, backing off, or already spent
   *  on this post -- a retry is worth something only on a different address. */
  const pick = (exclude?: Set<string>): Lane | null => {
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[(cursor + i) % lanes.length];
      if (lane.dead || lane.gate.isOpen()) continue;
      if (exclude?.has(lane.label)) continue;
      cursor = (cursor + i + 1) % lanes.length;
      return lane;
    }

    /* Nothing usable. Before reporting that, try to buy an address.
     *
     * Every remaining lane is latched, dead, or already spent on this post, and
     * a latched lane will not reopen inside this run -- its cooldown outlasts
     * the deadline. Returning null here is what produced fifteen posts reported
     * as "skipped while backing off" without a single request being made on
     * their behalf. A replacement is a different IP with a clean gate, so it is
     * a real answer to the situation rather than a wait. */
    for (let i = 0; i < lanes.length; i++) {
      const lane = lanes[(cursor + i) % lanes.length];
      if (!lane.dead && !lane.gate.isOpen()) continue; // usable but excluded
      if (!replaceLane(lane)) break; // budget spent; stop asking
      cursor = (cursor + i + 1) % lanes.length;
      return lane;
    }
    return null;
  };

  /** One read on one lane. Null means THIS LANE failed, not that the post is
   *  unreadable -- the caller decides whether another address is worth trying. */
  const attemptOn = async (lane: Lane, url: string): Promise<TikTokPostLookup | null> => {
    // Paces this address only. Other lanes are unaffected by this wait.
    if (!(await lane.gate.acquire())) return null;

    try {
      const sandbox = await boot(lane);
      const result = await sandbox.runCommand(
        "curl",
        [
          "-sL",
          "--max-time",
          "20",
          "-A",
          UA,
          "-H",
          "accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "-H",
          "accept-language: en-US,en;q=0.9",
          url,
        ],
        { timeoutMs: 30_000 }
      );
      const stdout: string =
        typeof (result as any).stdout === "function"
          ? await (result as any).stdout()
          : (result as any).stdout;

      if (!stdout) {
        lane.gate.recordBlocked();
        log.warn("sandbox curl returned nothing", { lane: lane.label, url });
        return null;
      }

      const lookup = readTikTokPostHtml(stdout);
      /* "Answered but unparseable" is the WAF shell reaching this lane too --
         the early warning that this address is being walled. A deleted post is
         a real answer and must not count against it. */
      if (lookup.state === "unavailable") lane.gate.recordChallenged();
      else lane.gate.recordSuccess();
      /* Retire it as soon as it latches rather than leaving the next post to
         find out. The answer this call obtained is still returned -- the lane
         being finished does not invalidate what it just said. */
      if (lane.gate.isOpen()) replaceLane(lane);
      return lookup;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      /* A failure before this lane ever booted will repeat for every post sent
         to it, so retire the lane rather than making each post pay the boot
         timeout. The pool carries on with the rest. */
      if (!lane.sandbox) {
        lane.dead = true;
        log.error("lane could not boot; retiring it for this run", {
          lane: lane.label,
          region: lane.region,
          error: message,
        });
      } else {
        lane.gate.recordBlocked();
        log.warn("sandbox read failed", { lane: lane.label, url, error: message });
      }
      return null;
    }
  };

  return {
    get size() {
      return lanes.filter((l) => !l.dead).length;
    },

    async readPost(url) {
      /* Ask a different address before giving up on the post.
       *
       * A wall is a fact about one IP at one moment, not about the post: the
       * same URL that returns the Slardar shell to one lane returns the full
       * page to the next, which is the whole premise of holding several. A
       * single attempt threw that away and reported the post unmeasurable.
       *
       * Bounded three ways, because "retry until it works" against a WAF is how
       * a refresh turns into an infinite loop: a fixed attempt budget, a lane
       * set that each attempt removes from (so attempts cannot exceed the
       * number of addresses we hold), and pick() refusing lanes whose breaker
       * has latched. There is no path here that revisits an address. */
      const tried = new Set<string>();
      /* Not capped at lanes.length any more. That cap was correct while the set
         of addresses was fixed; with replacement available, a one-lane pool --
         which is what the per-post "Sync Now" button opens -- could otherwise
         make exactly one attempt on exactly one address and report the post
         unmeasurable if that single IP happened to be walled. */
      const budget = Math.max(1, maxAttempts);
      let walled: TikTokPostLookup | null = null;
      let asked = 0;

      /* Bounded by `tried` before it is bounded by anything else: pick() refuses
         a lane already in the set and the set gains exactly one lane per turn,
         so this cannot run more times than there are lanes no matter what any
         counter does. The budget below is the tighter of the two limits, not
         the only one. */
      while (asked < budget) {
        let lane = pick(tried);
        /* Every address we hold has already been asked about this post and
           walled it. A wall is a fact about one IP at one moment, so the useful
           move is to obtain an IP we have not used -- not to re-ask one that
           just said no, and not to give up while the attempt budget is unspent.
           
           This is the path the per-post Sync Now button takes: it opens a
           single lane, so `tried` covers the whole pool after one attempt.
           Without this it made exactly one request and reported the post
           unmeasurable, which is what it was observed doing on production while
           Refresh Data measured the same post successfully. The gate has not
           latched at that point -- one wall is far below challengeThreshold --
           so replacing burned lanes alone does not reach this case. */
        if (!lane && walled) {
          for (const candidate of lanes) {
            if (!tried.has(candidate.label)) continue;
            if (!replaceLane(candidate)) break; // budget spent
            lane = candidate;
            break;
          }
        }
        if (!lane) break; // no address left, and none obtainable
        tried.add(lane.label);

        const lookup = await attemptOn(lane, url);
        if (lookup === null) {
          /* A lane that could not boot never asked TikTok anything, so it must
             not spend the post's attempts -- three failed boots would otherwise
             exhaust the budget and the healthy lane behind them would never be
             tried at all. Any other failure did reach the wire and counts. */
          if (!lane.dead) asked++;
          continue;
        }
        asked++;
        /* Live or deleted is TikTok actually answering about this post. Both are
           final -- re-asking a deleted post from five addresses gets five
           identical answers and costs five slots that other posts needed. */
        if (lookup.state !== "unavailable") return lookup;
        walled = lookup;
      }

      /* Walled everywhere we tried, or no lane was available. Either way the
         caller still gets its turn at the direct egress. */
      return walled;
    },

    async close() {
      await Promise.all(
        lanes.map(async (lane) => {
          const p = lane.sandbox;
          lane.sandbox = null;
          if (!p) return;
          await p.then((s) => s.delete({ deleteOrphanSnapshots: true })).catch(() => {});
        })
      );
    },
  };
}

/** One lane. Kept for callers that fetch a single post and would rather not
 *  pay to boot a pool. */
export function openSandboxPostFetcher(): SandboxPostFetcher {
  return openSandboxPostPool(1);
}
