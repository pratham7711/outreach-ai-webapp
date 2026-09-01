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
export function laneCountFor(
  postCount: number,
  targetSeconds: number = envInt("TIKTOK_SANDBOX_TARGET_SECONDS", 35),
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
  label: string;
  region: string;
  gate: ReturnType<typeof createRateGate>;
  sandbox: Promise<Sandbox> | null;
  /** This lane is done for the run: it could not boot. Others carry on. */
  dead: boolean;
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

  const lanes: Lane[] = Array.from({ length: laneCount }, (_, i) => ({
    label: `lane-${i}`,
    region: REGIONS[i % REGIONS.length],
    /* Its own gate, and not shared with the direct fetch's tiktokGate: those are
       two different identities, and one breaker across both would let either
       silence the other. Same reasoning separates the lanes from each other. */
    gate: createRateGate({
      minGapMs: envInt("TIKTOK_SANDBOX_MIN_GAP_MS", 1500),
      jitterMs: envInt("TIKTOK_SANDBOX_JITTER_MS", 600),
      breakerThreshold: envInt("TIKTOK_SANDBOX_BREAKER_THRESHOLD", 5),
      breakerCooldownMs: envInt("TIKTOK_SANDBOX_BREAKER_COOLDOWN_MS", 10 * 60 * 1000),
      challengeThreshold: envInt("TIKTOK_SANDBOX_CHALLENGE_THRESHOLD", 10),
      challengeCooldownMs: envInt("TIKTOK_SANDBOX_CHALLENGE_COOLDOWN_MS", 5 * 60 * 1000),
    }),
    sandbox: null,
    dead: false,
  }));

  let cursor = 0;

  const boot = (lane: Lane) => {
    if (!lane.sandbox) {
      lane.sandbox = Sandbox.create({
        region: lane.region as any,
        timeout: SANDBOX_LIFETIME_MS,
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
      const budget = Math.min(maxAttempts, lanes.length);
      let walled: TikTokPostLookup | null = null;
      let asked = 0;

      /* Bounded by `tried` before it is bounded by anything else: pick() refuses
         a lane already in the set and the set gains exactly one lane per turn,
         so this cannot run more times than there are lanes no matter what any
         counter does. The budget below is the tighter of the two limits, not
         the only one. */
      while (asked < budget) {
        const lane = pick(tried);
        if (!lane) break; // every remaining lane is dead, tried, or backing off
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
          await p.then((s) => s.stop()).catch(() => {});
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
