import { createLogger } from "@/lib/observability/logger";
import { fallbackKillKey, isKilled } from "@/lib/ops/killSwitch";
import { planBWorkerConfig } from "@/lib/trackers/planBWorker";
import { readTikTokPostHtml, type TikTokPostLookup } from "./fetchPostMetrics";
import { tiktokPageUrl } from "./postUrl";
import { httpWorkerExit, type TikTokExit } from "./tiktokExit";
import type { SandboxPostFetcher } from "./tiktokPostSandbox";

/**
 * Plan B for TikTok post reads: the creator trackers' own worker.
 *
 * Plan A is the Sandbox lane pool (tiktokPostSandbox.ts). It fails in two
 * ways that say nothing about the post: a lane cannot boot (Sandbox outage, the
 * spend cap, sandboxLanes 0), or every address it holds is walled. Either way
 * the post used to fall straight through to this project's function egress,
 * which TikTok walls about three times in four.
 *
 * The worker is scripts/creator-worker/fetch-server.mjs on a non-AWS network --
 * the same box the tracker switch moves to in position B, configured by the
 * same TRACKER_PLAN_B_URL / TRACKER_PLAN_B_TOKEN. It fetches with the same curl
 * flags as a lane and paces itself to one request per 1.8 s, so this side sends
 * at most WORKER_CONCURRENCY at a time and lets the worker queue them.
 *
 * Off switch: "source:tiktok-worker" on the ops page (no redeploy), or unset
 * the two env vars. "source:tiktok" stops it along with plan A.
 */

export const WORKER_KILL_KEY = fallbackKillKey("tiktok-worker");
/** In flight at once. The worker serialises anyway; two keeps its queue fed. */
export const WORKER_CONCURRENCY = 2;
/** Consecutive transport failures before the worker is left alone for the run. */
export const WORKER_GIVE_UP_STREAK = 5;

const log = () => createLogger({ context: { platform: "TIKTOK", via: "worker" } });

/** A post reader on the worker, or null when this deployment has no worker. */
export function openWorkerPostFetcher(
  env: NodeJS.ProcessEnv = process.env,
  exit?: TikTokExit,
): SandboxPostFetcher | null {
  const config = planBWorkerConfig(env);
  if (!config && !exit) return null;
  const worker =
    exit ??
    httpWorkerExit({ baseUrl: config!.baseUrl, token: config!.token, label: `posts:${new URL(config!.baseUrl).host}` });

  let failStreak = 0;
  let spent = false;

  return {
    size: WORKER_CONCURRENCY,
    async readPost(url) {
      if (spent) return null;
      if (await isKilled(WORKER_KILL_KEY)) return null;
      const page = await worker.fetchPage(tiktokPageUrl(url));
      if (!page) {
        failStreak += 1;
        if (failStreak >= WORKER_GIVE_UP_STREAK) {
          spent = true;
          log().warn("worker unreachable; plan B off for the rest of this run", { failures: failStreak });
        }
        return null;
      }
      failStreak = 0;
      return readTikTokPostHtml(page.body);
    },
    async close() {
      await worker.close().catch(() => {});
    },
  };
}

/**
 * Plan A, then plan B for whatever plan A could not deliver.
 *
 * "Could not deliver" is null (the lane died) or an `unavailable` lookup (every
 * address walled). A deleted or live answer is TikTok's verdict and is returned
 * as is. When the worker cannot do better, plan A's own answer is kept, so a
 * walled-everywhere post still reaches fetchTikTokMetrics as a refusal rather
 * than as a dead lane.
 *
 * With no worker this returns `primary` itself, so a deployment without
 * TRACKER_PLAN_B_* behaves exactly as before.
 */
export function withWorkerFallback(
  primary: SandboxPostFetcher | undefined,
  worker: SandboxPostFetcher | null,
): SandboxPostFetcher | undefined {
  if (!worker) return primary;
  if (!primary) return worker;

  let rescued = 0;
  return {
    get size() {
      return primary.size > 0 ? primary.size : worker.size;
    },
    async readPost(url) {
      const first = await primary.readPost(url);
      if (first && first.state !== "unavailable") return first;
      const second: TikTokPostLookup | null = await worker.readPost(url);
      if (second && second.state !== "unavailable") {
        rescued += 1;
        return second;
      }
      return first ?? second;
    },
    async close() {
      if (rescued) log().info("worker carried posts plan A could not", { rescued });
      await Promise.all([primary.close().catch(() => {}), worker.close().catch(() => {})]);
    },
  };
}
