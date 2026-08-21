/**
 * Fetches the latest statistics record for every CreatorCore post, by id.
 *
 *   node --env-file=.env scripts/creatorcore/cc-fetch-stats.mjs
 *
 * Why by id. Our post engagement counters are zero for 18,602 of 18,708 posts
 * because the bulk listing of `statistic-post` never returned a row -- the
 * Bubble backend answers `GET /obj/statistic-post?limit=5` with 400 "Database
 * query timeout", every time, at every page size. But each post carries
 * `lastStatistics`, the id of its most recent stats row, and
 * `GET /obj/statistic-post/<id>` answers 200 immediately. So the listing is
 * unusable and unnecessary: 18,660 keyed reads get the same data.
 *
 * Verified against the reference UI before writing this: post @kewbi_ returns
 * likes 57,832 / comments 209 / shares 1,083 / downloads 380 / views 592,580 /
 * rate 0.1004, which is exactly what CreatorCore's own Posts tab renders for it.
 *
 * Read-only against CreatorCore. Resumable: every record is appended as JSONL
 * and already-fetched ids are skipped, so a crash or a rate-limit costs only the
 * in-flight batch. Politeness is deliberate -- small concurrency, a pause between
 * batches, exponential backoff on failure.
 *
 * Out: scripts/creatorcore/out/statistic-post.jsonl  (gitignored)
 * Then: node --env-file=.env scripts/creatorcore/cc-apply-stats.mjs
 */
import { chromium } from "playwright";
import { createReadStream, existsSync, appendFileSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

const EMAIL = process.env.CC_EMAIL;
const PASSWORD = process.env.CC_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("CC_EMAIL and CC_PASSWORD must be set in webapp/.env (gitignored).");
  process.exit(1);
}

const BASE = "https://app.creatorcore.co";
const OUT_DIR = path.join(import.meta.dirname, "out");
const POSTS = path.join(OUT_DIR, "post.jsonl");
const OUT = path.join(OUT_DIR, "statistic-post.jsonl");

const CONCURRENCY = 4; // keyed reads are cheap for them, but stay polite
const BATCH_PAUSE_MS = 120;
const MAX_RETRIES = 5;
const PROGRESS_EVERY = 250;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Every (post, stats) pair we still need. */
async function pending() {
  const done = new Set();
  if (existsSync(OUT)) {
    for (const line of readFileSync(OUT, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const id = JSON.parse(line)._id;
        if (id) done.add(id);
      } catch {
        // A half-written final line from a previous kill; the id gets refetched.
      }
    }
  }

  const todo = [];
  const stream = createInterface({ input: createReadStream(POSTS), crlfDelay: Infinity });
  for await (const line of stream) {
    if (!line.trim()) continue;
    const post = JSON.parse(line);
    if (post.lastStatistics && !done.has(post.lastStatistics)) {
      todo.push({ postId: post._id, statId: post.lastStatistics });
    }
  }
  return { todo, alreadyDone: done.size };
}

/** One keyed read, inside the page so it carries the session cookie. */
async function fetchOne(page, statId) {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    const res = await page
      .evaluate(
        async ({ base, id }) => {
          const r = await fetch(`${base}/api/1.1/obj/statistic-post/${id}`, {
            credentials: "include",
          });
          let body = null;
          try {
            body = await r.json();
          } catch {}
          return { status: r.status, record: body?.response ?? null };
        },
        { base: BASE, id: statId },
      )
      .catch(() => ({ status: 0, record: null }));

    if (res.status === 200 && res.record) return res.record;
    // A missing record is a fact about the data, not a failure to retry.
    if (res.status === 404) return null;
    await sleep(Math.min(20_000, 500 * 2 ** (attempt - 1)));
  }
  return null;
}

const { todo, alreadyDone } = await pending();
console.log(
  `${todo.length} stats records to fetch` +
    (alreadyDone ? ` (${alreadyDone} already on disk, skipping)` : ""),
);
if (todo.length === 0) {
  console.log("nothing to do");
  process.exit(0);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

let written = 0;
let missing = 0;
const startedAt = Date.now();

try {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  try {
    await page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 45_000 });
  } catch {
    const state = await page.evaluate(() => ({
      url: location.href,
      text: document.body.innerText.replace(/\s+/g, " ").slice(0, 300),
    }));
    console.error(`login did not leave /auth\n  url:  ${state.url}\n  page: ${state.text}`);
    process.exit(1);
  }
  await page.waitForTimeout(5000);
  console.log("logged in\n");

  for (let i = 0; i < todo.length; i += CONCURRENCY) {
    const batch = todo.slice(i, i + CONCURRENCY);
    const records = await Promise.all(batch.map((t) => fetchOne(page, t.statId)));

    const lines = [];
    for (let j = 0; j < records.length; j += 1) {
      if (records[j]) {
        // Carry the post id: the stats row references it, but this keeps the
        // importer from having to trust that field.
        lines.push(JSON.stringify({ ...records[j], __postId: batch[j].postId }));
      } else {
        missing += 1;
      }
    }
    if (lines.length) {
      appendFileSync(OUT, lines.join("\n") + "\n");
      written += lines.length;
    }

    if (written % PROGRESS_EVERY < CONCURRENCY || i + CONCURRENCY >= todo.length) {
      const done = i + batch.length;
      const rate = done / ((Date.now() - startedAt) / 1000);
      const etaMin = Math.round((todo.length - done) / rate / 60);
      console.log(
        `  ${done}/${todo.length}  written ${written}  missing ${missing}  ` +
          `${rate.toFixed(1)}/s  eta ~${etaMin}m`,
      );
    }
    await sleep(BATCH_PAUSE_MS);
  }

  console.log(`\ndone: ${written} records written, ${missing} unavailable → ${OUT}`);
} finally {
  await browser.close();
}
