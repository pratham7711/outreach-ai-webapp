import { Sandbox } from "@vercel/sandbox";
import { createLogger } from "@/lib/observability/logger";
import { createRateGate, readTikTokPostHtml, type TikTokPostLookup } from "./fetchPostMetrics";

/**
 * Post metrics, fetched from an egress TikTok actually answers.
 *
 * Same measured asymmetry that tiktokProfileSandbox.ts already exploits for
 * profile pages, and it holds for video-detail pages too (measured 2026-09-02,
 * eight of eight PARA PARA posts): TikTok's WAF serves this project's function
 * egress a ~1.4KB Slardar login shell roughly three times in four, while a
 * plain curl from a Vercel Sandbox in iad1 returns the full ~390KB
 * server-rendered page with the rehydration payload intact.
 *
 * That asymmetry is the whole reason this file exists. The direct fetch is not
 * rate limited into failure -- it is refused on identity, so pacing it more
 * slowly does not help and a paid third-party API is not required either. The
 * fix is to ask from somewhere TikTok answers.
 *
 * One sandbox per refresh run, created lazily: creation costs a few seconds and
 * is billed by lifetime, so a run with no TikTok posts never pays for one, and
 * a run with eighty-six amortises it to nothing.
 */

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Comfortably longer than the 260s refresh deadline; the run closes it first. */
const SANDBOX_LIFETIME_MS = 5 * 60 * 1000;

export type SandboxPostFetcher = {
  /** Null means the sandbox itself failed, not that the post is unreadable --
   *  the caller falls back to the direct fetch rather than reporting a verdict
   *  it did not actually get from TikTok. */
  readPost: (url: string) => Promise<TikTokPostLookup | null>;
  close: () => Promise<void>;
};

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

export function openSandboxPostFetcher(): SandboxPostFetcher {
  const log = createLogger({ context: { platform: "TIKTOK", via: "sandbox" } });

  /* Its own gate, not the direct fetch's. The breaker describes one egress's
     standing with TikTok and these are two different identities: the sandbox
     being answered says nothing about the function egress being refused, and
     sharing a gate would let either one silence the other.
     Pacing matters here precisely because this path works -- without it the run
     fires eighty-six curls from one sandbox IP at whatever concurrency the
     caller uses, which is how a working egress stops working. 1.5s + jitter is
     the cadence the 8/8 measurement was taken at.
     The thresholds are deliberately tighter than the direct path's: a sandbox
     that starts getting walled has nothing left to fall back to, so it should
     stop asking early rather than burn the run proving it. */
  const gate = createRateGate({
    minGapMs: envInt("TIKTOK_SANDBOX_MIN_GAP_MS", 1500),
    jitterMs: envInt("TIKTOK_SANDBOX_JITTER_MS", 600),
    breakerThreshold: envInt("TIKTOK_SANDBOX_BREAKER_THRESHOLD", 5),
    breakerCooldownMs: envInt("TIKTOK_SANDBOX_BREAKER_COOLDOWN_MS", 10 * 60 * 1000),
    challengeThreshold: envInt("TIKTOK_SANDBOX_CHALLENGE_THRESHOLD", 10),
    challengeCooldownMs: envInt("TIKTOK_SANDBOX_CHALLENGE_COOLDOWN_MS", 5 * 60 * 1000),
  });
  let sandboxPromise: Promise<Sandbox> | null = null;
  /* One boot failure condemns the run. Without this every one of eighty-six
     posts pays the full sandbox-creation timeout before falling back, which
     costs far more than the refresh's whole budget. */
  let unavailable = false;

  const get = () => {
    if (!sandboxPromise) {
      sandboxPromise = Sandbox.create({
        // iad1 is where the successful reads were measured. Not the project
        // region (sin1), and deliberately so.
        region: "iad1",
        timeout: SANDBOX_LIFETIME_MS,
      });
      sandboxPromise.catch(() => {
        sandboxPromise = null;
      });
    }
    return sandboxPromise;
  };

  return {
    async readPost(url) {
      if (unavailable) return null;
      if (!(await gate.acquire())) {
        log.warn("sandbox read skipped; breaker open", { url });
        return null;
      }

      try {
        const sandbox = await get();
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
          gate.recordBlocked();
          log.warn("sandbox curl returned nothing", { url });
          return null;
        }

        const lookup = readTikTokPostHtml(stdout);
        /* "Answered but unparseable" is the WAF shell arriving here too -- the
           signal that this egress is starting to be walled. A deleted post is a
           real answer and must not count against it. */
        if (lookup.state === "unavailable") gate.recordChallenged();
        else gate.recordSuccess();
        return lookup;
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        /* A failure before the first command ever ran is a boot failure, and it
           will repeat for every remaining post. Anything later is one bad curl,
           and the next post deserves its own attempt. */
        if (!sandboxPromise) {
          unavailable = true;
          log.error("sandbox unavailable for this run; falling back to direct fetch", {
            error: message,
          });
        } else {
          gate.recordBlocked();
          log.warn("sandbox read failed", { url, error: message });
        }
        return null;
      }
    },

    async close() {
      const p = sandboxPromise;
      sandboxPromise = null;
      if (!p) return;
      await p.then((s) => s.stop()).catch(() => {});
    },
  };
}
