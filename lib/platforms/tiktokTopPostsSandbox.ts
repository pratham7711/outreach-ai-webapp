import { Sandbox } from "@vercel/sandbox";
import type { TopPost } from "./creatorProfile";

/**
 * TikTok post grids, read by REAL Chrome inside a Vercel Sandbox.
 *
 * The measurement that produced this file (2026-09-01, all four cases against
 * the same handle from iad1):
 *
 *   headless @sparticuz/chromium, Sandbox   → page + blob, item_list NEVER fires
 *   new-headless google-chrome, Sandbox     → page + blob, item_list fires but
 *                                             carries no itemList
 *   HEADED google-chrome under Xvfb, Sandbox → 30 posts, exact playCounts ✅
 *   real Chrome, local (India egress)        → placeholder page, nothing
 *
 * So the gate is not "a browser" and not even "real Chrome": it is a real
 * Chrome with a real display. Xvfb satisfies it. That is why this launches
 * through `xvfb-run` with `headless: false` and why the comments elsewhere
 * saying the grid needs a paid scraper are now wrong.
 *
 * Shape of the run: one sandbox, one apt-get of google-chrome-stable and xvfb
 * (~90s, the dominant cost), then ONE node process that walks every handle in
 * a single Chrome. Per-handle sandboxes would pay that setup each time, which
 * is why this reads a batch rather than exposing a per-creator `read()` the way
 * tiktokProfileSandbox does.
 */

/** Setup is ~90s and each handle ~15s; sized for a batch plus slack. */
const SANDBOX_LIFETIME_MS = 10 * 60 * 1000;
const SETUP_TIMEOUT_MS = 5 * 60 * 1000;
/** Per-handle budget the in-sandbox script enforces for itself. */
const PER_HANDLE_MS = 45_000;

/** Just the two methods used, so lib/observability's Logger satisfies it
    structurally without this module importing it. */
type SandboxLogger = {
  info: (msg: string, extra?: Record<string, unknown>) => void;
  warn: (msg: string, extra?: Record<string, unknown>) => void;
};

export type SandboxTopPostsResult = {
  handle: string;
  posts: TopPost[];
  /** Present when the read failed; carries the page evidence. */
  error?: string;
};

/* The in-sandbox reader. Kept as a string rather than a file because the
   sandbox has no checkout of this repo -- it is written with a heredoc, so
   nothing here may contain an unescaped `EOS` line. */
const PROBE_SCRIPT = String.raw`
import { chromium } from "playwright-core";

const handles = process.argv.slice(2);
const PER_HANDLE_MS = ${PER_HANDLE_MS};

const browser = await chromium.launch({ channel: "chrome", headless: false });
const out = [];

for (const handle of handles) {
  const clean = String(handle).replace(/^@/, "").trim();
  if (!clean) continue;
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  let items = null;
  page.on("response", async (r) => {
    if (items || !r.url().includes("/api/post/item_list/")) return;
    try {
      const b = await r.text();
      if (!b) return;
      const p = JSON.parse(b);
      if (Array.isArray(p.itemList) && p.itemList.length) items = p.itemList;
    } catch {}
  });
  try {
    await page.goto("https://www.tiktok.com/@" + encodeURIComponent(clean), {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    const deadline = Date.now() + PER_HANDLE_MS;
    let scrolls = 0;
    while (!items && Date.now() < deadline) {
      await page.waitForTimeout(600);
      if (scrolls < 4 && Date.now() > deadline - PER_HANDLE_MS + 4000 * (scrolls + 1)) {
        scrolls += 1;
        await page.mouse.wheel(0, 1500).catch(() => {});
      }
    }
    if (!items) {
      const evidence = await page
        .evaluate(() => 'title="' + document.title.slice(0, 50) + '" len=' + document.documentElement.outerHTML.length)
        .catch(() => "page unreadable");
      out.push({ handle: clean, posts: [], error: "no grid: " + evidence });
    } else {
      const posts = items
        .filter((it) => it && it.id)
        .map((it) => {
          const count = (key) => {
            const v2 = Number(it.statsV2 && it.statsV2[key]);
            if (Number.isFinite(v2)) return v2;
            const v1 = Number(it.stats && it.stats[key]);
            return Number.isFinite(v1) ? v1 : null;
          };
          return {
            postId: String(it.id),
            url: "https://www.tiktok.com/@" + clean + "/video/" + it.id,
            caption: typeof it.desc === "string" && it.desc ? it.desc : null,
            coverUrl: (it.video && (it.video.cover || it.video.dynamicCover)) || null,
            views: count("playCount"),
            likes: count("diggCount"),
            comments: count("commentCount"),
            postedAt:
              typeof it.createTime === "number" && it.createTime > 0
                ? new Date(it.createTime * 1000).toISOString()
                : null,
          };
        });
      out.push({ handle: clean, posts });
    }
  } catch (e) {
    out.push({ handle: clean, posts: [], error: String((e && e.message) || e).slice(0, 160) });
  } finally {
    await page.close().catch(() => {});
  }
}

await browser.close();
console.log("__RESULT__" + JSON.stringify(out));
`;

const SETUP_SCRIPT = `
set -e
export DEBIAN_FRONTEND=noninteractive
wget -qO- https://dl.google.com/linux/linux_signing_key.pub | sudo gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list >/dev/null
sudo apt-get update -qq >/dev/null 2>&1
sudo apt-get install -y -qq google-chrome-stable xvfb >/dev/null 2>&1
google-chrome --version
mkdir -p /tmp/tp && cd /tmp/tp
npm init -y >/dev/null 2>&1
npm install playwright-core@1.58.2 >/dev/null 2>&1
cat > probe.mjs <<'EOS'
${PROBE_SCRIPT}
EOS
echo SETUP_OK
`;

function stdoutOf(result: unknown): string {
  const r = result as { stdout?: unknown };
  return typeof r.stdout === "function"
    ? ((r.stdout as () => Promise<string> | string)() as unknown as string)
    : ((r.stdout as string) ?? "");
}

async function readStdout(result: unknown): Promise<string> {
  const value = stdoutOf(result);
  return typeof (value as unknown as Promise<string>)?.then === "function"
    ? await (value as unknown as Promise<string>)
    : value;
}

/**
 * Reads the grids for a batch of handles. Never throws: a whole-batch failure
 * comes back as one error per handle, so the caller records nothing rather
 * than erasing anything.
 */
export async function readTopPostsInSandbox(
  handles: string[],
  { logger }: { logger?: SandboxLogger } = {}
): Promise<SandboxTopPostsResult[]> {
  const clean = handles.map((h) => h.replace(/^@/, "").trim()).filter(Boolean);
  if (clean.length === 0) return [];

  let sandbox: Sandbox | null = null;
  const started = Date.now();
  try {
    sandbox = await Sandbox.create({ region: "iad1", timeout: SANDBOX_LIFETIME_MS });

    const setup = await sandbox.runCommand("bash", ["-lc", SETUP_SCRIPT], {
      timeoutMs: SETUP_TIMEOUT_MS,
    });
    const setupOut = await readStdout(setup);
    if (!setupOut.includes("SETUP_OK")) {
      throw new Error(`sandbox setup did not complete: ${setupOut.slice(-200)}`);
    }
    logger?.info("top-posts sandbox ready", { setupMs: Date.now() - started });

    /* xvfb-run is the whole point: real Chrome with a real display. Headless --
       old or new -- returns a page and no grid. */
    const run = await sandbox.runCommand(
      "bash",
      ["-lc", `cd /tmp/tp && xvfb-run -a node probe.mjs ${clean.map((h) => `'${h.replace(/'/g, "")}'`).join(" ")}`],
      { timeoutMs: Math.min(SANDBOX_LIFETIME_MS - 60_000, 60_000 + clean.length * (PER_HANDLE_MS + 15_000)) }
    );
    const out = await readStdout(run);
    const marker = out.lastIndexOf("__RESULT__");
    if (marker === -1) {
      throw new Error(`reader produced no result line: ${out.slice(-200)}`);
    }
    const parsed = JSON.parse(out.slice(marker + "__RESULT__".length).trim());
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    logger?.warn("top-posts sandbox failed", { detail });
    return clean.map((handle) => ({ handle, posts: [], error: `sandbox: ${detail}` }));
  } finally {
    await sandbox?.stop().catch(() => {});
  }
}
