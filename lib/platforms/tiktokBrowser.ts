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

export function createBrowserSession<Arg, Out>(
  readWith: (browser: LaunchedBrowser, arg: Arg, timeoutMs: number) => Promise<Out | null>,
  { defaultTimeoutMs = 45_000, hardCapMs = 90_000 }: { defaultTimeoutMs?: number; hardCapMs?: number } = {}
): BrowserSession<Arg, Out> {
  let browserPromise: Promise<LaunchedBrowser> | null = null;

  const dispose = () => {
    const dead = browserPromise;
    browserPromise = null;
    dead?.then((b) => b.close()).catch(() => {});
  };

  return {
    async read(arg, { timeoutMs = defaultTimeoutMs } = {}) {
      if (!browserPromise) {
        browserPromise = withTimeout(launch(), LAUNCH_TIMEOUT_MS, "browser launch").then(
          async (browser) => {
            /* The keeper page. With it open, closing a read's page never drops
               the page count to zero, which is the state --single-process
               Chromium wedges in. Never navigated, never closed until the
               session is. */
            await browser.newPage({}).catch(() => {});
            return browser;
          }
        );
        browserPromise.catch(() => {
          browserPromise = null;
        });
      }

      try {
        const browser = await browserPromise;
        return await withTimeout(readWith(browser, arg, timeoutMs), hardCapMs, "browser read");
      } catch {
        /* Whatever wedged or died stays disposed; the next read relaunches
           rather than queueing behind a browser that will never answer. */
        dispose();
        return null;
      }
    },
    async close() {
      dispose();
    },
  };
}
