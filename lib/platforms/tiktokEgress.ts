import { createLogger } from "@/lib/observability/logger";
import {
  laneCountFor,
  openSandboxPostFetcher,
  openSandboxPostPool,
  type SandboxPostFetcher,
} from "./tiktokPostSandbox";
import { openTikTokProxyPool, proxiesConfigured } from "./tiktokProxy";

/**
 * Pick the best TikTok egress available, and fall back down the ladder.
 *
 * Every caller that reads TikTok posts in bulk wants the same thing -- "get me
 * an egress TikTok will answer" -- and none of them should care which kind it
 * turns out to be. Before this module they all named openSandboxPostPool
 * directly, which meant adding a better egress would have to be repeated at
 * three call sites and would be silently missed at a fourth.
 *
 * The ladder, best first:
 *
 *   1. RESIDENTIAL PROXY POOL -- when TIKTOK_PROXY_URL(S) is set. Different
 *      class of address, so it changes the pass rate rather than the number of
 *      attempts at the old one. No boot latency and no per-second billing.
 *   2. SANDBOX POOL -- AWS datacenter addresses, but many of them, and TikTok
 *      answers them far more often than it answers this project's own function
 *      egress. Today's behaviour, and still the whole story when no proxy is
 *      configured.
 *   3. The direct function egress, which fetchTikTokMetrics already tries on
 *      its own after a fetcher comes back empty. Not this module's business.
 *
 * The sandbox is opened LAZILY and only if the proxy actually fails to
 * deliver, so a working proxy pool never boots a sandbox and never bills a
 * second of Provisioned Memory. That laziness is the point: the two egresses
 * cost money in completely different shapes, and paying for both on every post
 * would be worse than either alone.
 */

const log = createLogger({ context: { platform: "TIKTOK", via: "egress" } });

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * How many proxy identities to hold for a given amount of work.
 *
 * Deliberately NOT laneCountFor. That function prices a sandbox lane -- boot
 * time amortised over posts, capped at 8 because each lane is a billed
 * machine. A proxy lane is a session string: it costs nothing to hold and its
 * only real limit is how fast the provider will let us go. So the sizing is
 * simply "one identity per few posts", generously capped.
 */
export function proxyLaneCountFor(postCount: number): number {
  if (postCount <= 0) return 0;
  const perLane = envInt("TIKTOK_PROXY_POSTS_PER_LANE", 4);
  const cap = envInt("TIKTOK_PROXY_MAX_LANES", 16);
  return Math.max(1, Math.min(cap, Math.ceil(postCount / perLane)));
}

export type EgressOptions = {
  /**
   * Override how many SANDBOX lanes the fallback may hold.
   *
   * The cron sets this. Its sizing is a deliberate cost decision -- two lanes,
   * because nobody is waiting on a cron run and a sandbox bills by lifetime --
   * and a shared factory that silently replaced it with laneCountFor's eight
   * would quadruple the standing sandbox cost of every hourly run. Sizing that
   * a caller reasoned about must survive being routed through here.
   *
   * Zero is meaningful and honoured: "proxies only, never boot a sandbox".
   */
  sandboxLanes?: number;
  /** Override the proxy identity count. Defaults to proxyLaneCountFor. */
  proxyLanes?: number;
};

/**
 * Open a fetcher sized for `postCount` posts, or undefined when there is no
 * TikTok work to do.
 *
 * Returns the same SandboxPostFetcher shape the sandbox pool always returned,
 * so callers and fetchTikTokMetrics need no new vocabulary.
 */
export function openTikTokPostFetcher(
  postCount: number,
  options: EgressOptions = {},
): SandboxPostFetcher | undefined {
  if (postCount <= 0) return undefined;

  const sandboxLanes = options.sandboxLanes ?? laneCountFor(postCount);
  const openSandbox = () => (sandboxLanes > 0 ? openSandboxPostPool(sandboxLanes) : undefined);

  if (!proxiesConfigured()) return openSandbox();

  const proxyLanes = options.proxyLanes ?? proxyLaneCountFor(postCount);
  const proxy = openTikTokProxyPool(proxyLanes);
  if (!proxy) {
    /* Configured but unopenable -- every URL was unparseable. Say so loudly
       rather than quietly running on the slower egress and leaving someone to
       wonder why the proxy spend bought nothing. */
    log.error("proxies are configured but no usable proxy URL parsed; using sandboxes", {
      postCount,
    });
    return openSandbox();
  }

  log.info("proxy pool opened", { proxyLanes, postCount, sandboxLanes });
  return withSandboxFallback(proxy, sandboxLanes);
}

/**
 * Wrap a proxy pool so a post the proxies could not deliver still gets a
 * sandbox's turn.
 *
 * "Could not deliver" is null (transport died) OR an `unavailable` lookup (the
 * WAF answered instead of TikTok). Both mean we have no numbers and no verdict,
 * and the sandbox is a genuinely different address family, so it is worth
 * asking. A `deleted` answer is a real verdict and is returned untouched -- a
 * sandbox would only confirm it at the price of booting a machine.
 */
function withSandboxFallback(proxy: SandboxPostFetcher, sandboxLanes: number): SandboxPostFetcher {
  /* Consecutive non-deliveries before the proxy pool is abandoned for the rest
     of the run. Without this, a dead provider makes every post pay a full proxy
     attempt AND a sandbox attempt -- twice the latency for the same answer.
     Consecutive rather than total, because an occasional wall is normal and
     only a sustained streak means the pool itself is the problem. */
  const giveUpAfter = envInt("TIKTOK_PROXY_GIVE_UP_STREAK", 12);

  let sandbox: SandboxPostFetcher | null = null;
  let sandboxOpened = false;
  let proxyStreak = 0;
  let proxySpent = false;
  let proxyDelivered = 0;
  let sandboxRescued = 0;

  /* One sandbox pool for the run, booted at the first post the proxies could
     not deliver. Sized from the whole run, not from the one post that failed:
     if the proxies are struggling, more will follow. */
  const ensureSandbox = (): SandboxPostFetcher | null => {
    if (!sandboxOpened) {
      sandboxOpened = true;
      sandbox = sandboxLanes > 0 ? openSandboxPostPool(sandboxLanes) : null;
      if (sandbox) log.info("escalating to sandbox pool", { lanes: sandboxLanes });
    }
    return sandbox;
  };

  return {
    get size() {
      /* The concurrency callers should run at. The proxy pool is the primary
         reader, so its lane count is the honest answer; the sandbox is a
         fallback, not extra capacity to fill. */
      return proxy.size;
    },

    async readPost(url: string) {
      if (!proxySpent) {
        const viaProxy = await proxy.readPost(url);
        if (viaProxy && viaProxy.state !== "unavailable") {
          proxyStreak = 0;
          proxyDelivered++;
          return viaProxy;
        }
        proxyStreak++;
        if (proxyStreak >= giveUpAfter) {
          proxySpent = true;
          log.warn("proxy pool gave up; sandboxes only for the rest of this run", {
            consecutiveFailures: proxyStreak,
            delivered: proxyDelivered,
          });
          /* Closed now rather than at run end: nothing else will use it, and
             holding open sockets to a provider we have stopped asking is pure
             waste. close() is idempotent enough to be called again below. */
          await proxy.close().catch(() => {});
        }
      }

      const viaSandbox = ensureSandbox();
      if (!viaSandbox) return null;
      const answer = await viaSandbox.readPost(url);
      if (answer && answer.state !== "unavailable") sandboxRescued++;
      return answer;
    },

    async close() {
      if (proxyDelivered || sandboxRescued) {
        log.info("egress run complete", { proxyDelivered, sandboxRescued, proxySpent });
      }
      await Promise.all([
        proxy.close().catch(() => {}),
        sandbox ? sandbox.close().catch(() => {}) : Promise.resolve(),
      ]);
    },
  };
}

/**
 * The single-post case: one identity, opened for one click.
 *
 * Replaces openSandboxPostFetcher at the Sync Now route, which paid a full
 * sandbox boot for one read. With proxies configured this is a plain HTTP
 * request and the click gets seconds faster; without them it is exactly the
 * one-lane sandbox it always was.
 */
export function openTikTokPostFetcherForOne(): SandboxPostFetcher {
  /* The no-proxy path stays literally the call it always was, rather than an
     equivalent spelling of it: openSandboxPostFetcher is the one-lane helper
     written for this caller, and routing around it would leave it exported with
     nothing calling it -- the exact shape of the bug fetcherWiring.test.ts
     exists to catch. */
  if (!proxiesConfigured()) return openSandboxPostFetcher();
  return openTikTokPostFetcher(1, { sandboxLanes: 1 }) ?? openSandboxPostFetcher();
}
