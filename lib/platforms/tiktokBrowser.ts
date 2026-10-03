import { createLogger } from "@/lib/observability/logger";

/**
 * The shared browser plumbing for every TikTok reader that needs one.
 *
 * Two hard-won rules live here:
 *
 * 1. One browser per sweep, launched lazily. Launching per item pays the
 *    launch (~half of each read) every time and races on the binary
 *    @sparticuz/chromium extracts to /tmp (ETXTBSY).
 *
 * 2. Never trust a browser call to return. The bundled Chromium runs
 *    --single-process; closing the last open page can wedge it, after which
 *    newPage() neither resolves nor rejects and the function sits there until
 *    the platform kills it -- "Task timed out after 300 seconds", one creator
 *    processed. Hence the keeper page (the page count never reaches zero), the
 *    hard timeout around every read, and the dispose-and-relaunch when a read
 *    fails: the next item gets a fresh browser instead of a dead one.
 */

export type LaunchedBrowser = {
  newPage: (opts: Record<string, unknown>) => Promise<any>;
  close: () => Promise<void>;
};

/**
 * Serverless Chromium in production, a local browser in development.
 * Resolved dynamically so the serverless build does not pull a
 * development-only path into the bundle.
 */
export async function launch(): Promise<LaunchedBrowser> {
  const { chromium: pw } = await import("playwright-core");

  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    const chromium = (await import("@sparticuz/chromium")).default;
    return (await pw.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })) as unknown as LaunchedBrowser;
  }

  return (await pw.launch({ channel: "chrome", headless: true })) as unknown as LaunchedBrowser;
}

const LAUNCH_TIMEOUT_MS = 60_000;

export function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} exceeded ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

export type BrowserSession<Arg, Out> = {
  read: (arg: Arg, opts?: { timeoutMs?: number }) => Promise<Out | null>;
  close: () => Promise<void>;
};

/**
 * Chromium's net::ERR_INSUFFICIENT_RESOURCES: the network stack could not get
 * the memory or buffer a request needs. Unlike every other failure here it
 * outlives a relaunch (see stopWhenExhausted), which points at the function
 * instance the browser runs in rather than at a page or a browser -- inferred
 * from that pattern in the logs, not observed directly.
 */
export function isResourceExhaustion(e: unknown): boolean {
  return /ERR_INSUFFICIENT_RESOURCES/.test(e instanceof Error ? e.message : String(e));
}

export function createBrowserSession<Arg, Out>(
  readWith: (browser: LaunchedBrowser, arg: Arg, timeoutMs: number) => Promise<Out | null>,
  {
    defaultTimeoutMs = 45_000,
    hardCapMs = 90_000,
    stopWhenExhausted = false,
  }: {
    defaultTimeoutMs?: number;
    hardCapMs?: number;
    /**
     * After the first ERR_INSUFFICIENT_RESOURCES, answer every later read with
     * null instead of relaunching.
     *
     * MEASURED in the creator sweep's production logs, 2026-09-30 to 10-02 (10
     * runs that hit it): never on a run's first browser page, always after
     * earlier pages in the same run had failed or timed out, and from the first
     * one on, every later browser read in that run failed the same way, a few
     * seconds apart -- at least 66 of them on 10-01 00:30 -- relaunch after
     * relaunch. The dispose-and-relaunch below cures a wedged browser; it did
     * not cure this, and each relaunch costs a launch and a page against the
     * run's deadline. Opt-in, because only the caller knows whether a null is
     * safe for it.
     */
    stopWhenExhausted?: boolean;
  } = {}
): BrowserSession<Arg, Out> {
  let browserPromise: Promise<LaunchedBrowser> | null = null;
  let exhausted = false;

  const dispose = () => {
    const dead = browserPromise;
    browserPromise = null;
    dead?.then((b) => b.close()).catch(() => {});
  };

  return {
    async read(arg, { timeoutMs = defaultTimeoutMs } = {}) {
      if (exhausted) return null;
      if (!browserPromise) {
        const launching = launch();
        /* The timeout covers the keeper page too. It used to cover launch()
           alone, and the keeper's newPage() is exactly the call rule 2 says can
           neither resolve nor reject: a wedge there left this promise pending
           forever, and every later read awaited it until the function was
           killed. */
        browserPromise = withTimeout(
          launching.then(async (browser) => {
            /* The keeper page. With it open, closing a read's page never drops
               the page count to zero, which is the state --single-process
               Chromium wedges in. Never navigated, never closed until the
               session is. */
            await browser.newPage({}).catch(() => {});
            return browser;
          }),
          LAUNCH_TIMEOUT_MS,
          "browser launch"
        );
        browserPromise.catch(() => {
          browserPromise = null;
          launching.then((b) => b.close()).catch(() => {});
        });
      }

      try {
        const browser = await browserPromise;
        return await withTimeout(readWith(browser, arg, timeoutMs), hardCapMs, "browser read");
      } catch (e) {
        /* Whatever wedged or died stays disposed; the next read relaunches
           rather than queueing behind a browser that will never answer. The
           error is rethrown, not swallowed: every caller has its own catch,
           and the message is the only evidence of what the page actually was. */
        dispose();
        if (stopWhenExhausted && isResourceExhaustion(e)) {
          exhausted = true;
          createLogger({ context: { platform: "TIKTOK", source: "browser" } }).warn(
            "browser out of resources; no further browser reads this run",
            { error: e instanceof Error ? e.message.split("\n")[0] : String(e) }
          );
        }
        throw e instanceof Error ? e : new Error(String(e));
      }
    },
    async close() {
      dispose();
    },
  };
}
