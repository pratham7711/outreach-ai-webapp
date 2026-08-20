// CreatorCore extractor — pages every Data-API-readable type to JSONL on disk.
//
// Why this exists: CreatorCore (a Bubble.io app) exposes a REST Data API, but the
// data is only served to an authenticated session, and the backend intermittently
// 400s with "Database query timeout" on unbounded queries. This script reuses YOUR
// login (Playwright persistent profile — you log in once in the launched browser),
// pages each type with cursor pagination, retries the flaky timeouts with backoff,
// and appends to JSONL so a crash resumes instead of restarting.
//
// Run:  node scripts/creatorcore/cc-extract.mjs
// Out:  scripts/creatorcore/out/<type>.jsonl  (+ .cursor checkpoints)
//
// The Data API only *exposes* 4 types (meta.get): campaign, post,
// statistic-post, campaign-postrefreshqueue. The rest are attempted and skipped
// if the server refuses them, so you get everything that is actually reachable.

import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "out");
const PROFILE = path.join(__dirname, ".profile"); // persisted login, gitignored
const BASE = "https://app.creatorcore.co";
const PAGE_SIZE = 100; // Bubble Data API hard max
const MAX_RETRIES = 8;

// Every type declared in /meta. The 4 truly exposed ones come first; the rest are
// best-effort ("every data you can") and skipped cleanly if the API refuses them.
const TYPES = [
  "campaign",
  "post",
  "statistic-post",
  "campaign-postrefreshqueue",
  "activation",
  "activation-satellite",
  "creator-satellite",
  "draft",
  "story",
  "storytag",
  "integration",
  "org-activationstatus",
  "campaign-postimportqueue",
  "org-creatorimportqueue",
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
fs.mkdirSync(OUT, { recursive: true });

// Fetch one page inside the page context (carries the session cookies).
async function fetchPage(page, type, cursor) {
  return page.evaluate(
    async ({ base, type, cursor, limit }) => {
      const url = `${base}/api/1.1/obj/${type}?limit=${limit}&cursor=${cursor}`;
      const r = await fetch(url, { credentials: "include" });
      let body = null;
      try {
        body = await r.json();
      } catch {}
      return {
        status: r.status,
        results: body?.response?.results ?? null,
        remaining: body?.response?.remaining ?? null,
        count: body?.response?.count ?? null,
        err: body?.body?.message || body?.message || null,
      };
    },
    { base: BASE, type, cursor, limit: PAGE_SIZE }
  );
}

async function extractType(page, type) {
  const outFile = path.join(OUT, `${type}.jsonl`);
  const curFile = path.join(OUT, `${type}.cursor`);
  let cursor = fs.existsSync(curFile) ? parseInt(fs.readFileSync(curFile, "utf8"), 10) || 0 : 0;
  if (cursor > 0) console.log(`  ↳ resuming ${type} at cursor ${cursor}`);

  let total = null;
  let wrote = cursor;
  for (;;) {
    let ok = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const res = await fetchPage(page, type, cursor);
      if (res.status === 200 && Array.isArray(res.results)) {
        ok = res;
        break;
      }
      // First page 404/403 => type not exposed. Bail without noise.
      if (cursor === 0 && (res.status === 404 || res.status === 403)) {
        console.log(`  - ${type}: not exposed via Data API (status ${res.status}), skipping`);
        return { type, exposed: false, wrote: 0 };
      }
      const backoff = Math.min(30000, 1000 * 2 ** (attempt - 1));
      console.log(`    . ${type} cursor ${cursor} status ${res.status} (${res.err || "?"}) - retry ${attempt}/${MAX_RETRIES} in ${backoff}ms`);
      await sleep(backoff);
    }
    if (!ok) {
      console.error(`  x ${type}: gave up at cursor ${cursor} after ${MAX_RETRIES} retries. Re-run to resume.`);
      return { type, exposed: true, wrote, incomplete: true };
    }
    if (total === null) total = (ok.count ?? 0) + (ok.remaining ?? 0);
    if (ok.results.length === 0) break;

    const lines = ok.results.map((r) => JSON.stringify(r)).join("\n") + "\n";
    fs.appendFileSync(outFile, lines);
    cursor += ok.results.length;
    wrote = cursor;
    fs.writeFileSync(curFile, String(cursor));
    process.stdout.write(`\r  ${type}: ${wrote}/${total ?? "?"}   `);
    if (ok.remaining === 0) break;
    await sleep(150); // be polite to the backend
  }
  process.stdout.write("\n");
  console.log(`  ok ${type}: ${wrote} records -> ${path.relative(process.cwd(), outFile)}`);
  return { type, exposed: true, wrote };
}

async function ensureLoggedIn(page) {
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" }).catch(() => {});
  for (let i = 0; i < 240; i++) {
    const probe = await fetchPage(page, "campaign", 0).catch(() => ({ status: 0 }));
    if (probe.status === 200 && (probe.count ?? 0) > 0) return true;
    if (i === 0) {
      console.log("\n>>> Log in to CreatorCore in the opened browser window.");
      console.log(">>> Waiting for an authenticated session (checks every 5s, up to 20 min)...\n");
    }
    await sleep(5000);
  }
  return false;
}

(async () => {
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    viewport: { width: 1280, height: 900 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  if (!(await ensureLoggedIn(page))) {
    console.error("Never reached an authenticated session. Aborting.");
    await ctx.close();
    process.exit(1);
  }
  console.log("Authenticated. Starting extraction.\n");

  const summary = [];
  for (const type of TYPES) {
    try {
      summary.push(await extractType(page, type));
    } catch (e) {
      console.error(`  x ${type} threw:`, e.message);
      summary.push({ type, error: e.message });
    }
  }

  fs.writeFileSync(path.join(OUT, "_summary.json"), JSON.stringify(summary, null, 2));
  console.log("\n=== Extraction summary ===");
  for (const s of summary) {
    console.log(
      `  ${s.type.padEnd(28)} ${s.error ? "ERROR " + s.error : s.exposed === false ? "not exposed" : (s.wrote ?? 0) + " records" + (s.incomplete ? " (INCOMPLETE - re-run to resume)" : "")}`
    );
  }
  console.log(`\nWrote JSONL to ${OUT}`);
  console.log("Next: npx tsx scripts/creatorcore/cc-import.ts  (see that file's header)");
  await ctx.close();
})();
