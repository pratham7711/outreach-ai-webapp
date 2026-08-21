/**
 * Can we fetch a statistic-post record directly by id?
 *
 *   node --env-file=.env scripts/creatorcore/cc-stats-probe.mjs
 *
 * The bulk listing of `statistic-post` returned zero rows -- the Bubble backend
 * times out on every page of it, which is why our post engagement counters are
 * all zero. But every post carries `lastStatistics`, a record id pointing at its
 * most recent stats row. Fetching those individually sidesteps the listing
 * entirely, so this probe answers two questions before any bulk run:
 *   1. Does GET /obj/statistic-post/<id> succeed where the listing fails?
 *   2. Does the record actually carry likes, comments, shares, saves, downloads?
 *
 * Read-only: three GETs. Prints field names and shapes, not values, except the
 * handful of numeric metrics that are the whole point.
 */
import { chromium } from "playwright";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

const EMAIL = process.env.CC_EMAIL;
const PASSWORD = process.env.CC_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("CC_EMAIL and CC_PASSWORD must be set in webapp/.env (gitignored).");
  process.exit(1);
}

const BASE = "https://app.creatorcore.co";
const POSTS = path.join(import.meta.dirname, "out", "post.jsonl");

/** First few posts that actually have a stats pointer. */
async function sampleIds(count) {
  const out = [];
  const stream = createInterface({
    input: createReadStream(POSTS),
    crlfDelay: Infinity,
  });
  for await (const line of stream) {
    if (!line.trim()) continue;
    const post = JSON.parse(line);
    if (post.lastStatistics) {
      out.push({ postId: post._id, statId: post.lastStatistics, username: post.username });
      if (out.length >= count) break;
    }
  }
  stream.close();
  return out;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();

try {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  try {
    await page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 45_000 });
  } catch {
    // Repeated logins can be throttled or challenged; say which rather than time out blind.
    const state = await page.evaluate(() => ({
      url: location.href,
      text: document.body.innerText.replace(/\s+/g, " ").slice(0, 400),
    }));
    console.error(`login did not leave /auth\n  url:  ${state.url}\n  page: ${state.text}`);
    process.exitCode = 1;
    throw new Error("login blocked");
  }
  await page.waitForTimeout(5000);
  console.log("logged in\n");

  const samples = await sampleIds(3);

  for (const s of samples) {
    const res = await page.evaluate(
      async ({ base, id }) => {
        const r = await fetch(`${base}/api/1.1/obj/statistic-post/${id}`, {
          credentials: "include",
        });
        let body = null;
        try {
          body = await r.json();
        } catch {}
        return { status: r.status, record: body?.response ?? null, err: body?.body?.message ?? null };
      },
      { base: BASE, id: s.statId },
    );

    console.log(`post ${s.postId} (@${s.username})`);
    console.log(`  GET statistic-post/${s.statId} -> ${res.status}${res.err ? ` (${res.err})` : ""}`);
    if (res.record) {
      const keys = Object.keys(res.record);
      console.log(`  ${keys.length} fields: ${keys.join(", ")}`);
      // The metrics are the point of the exercise, so show these.
      const metrics = Object.entries(res.record).filter(
        ([, v]) => typeof v === "number",
      );
      for (const [k, v] of metrics) console.log(`    ${k.padEnd(28)} ${v}`);
    }
    console.log("");
  }

  // Does the listing still fail? Worth knowing whether to bother with bulk.
  const listing = await page.evaluate(
    async ({ base }) => {
      const r = await fetch(`${base}/api/1.1/obj/statistic-post?limit=5&cursor=0`, {
        credentials: "include",
      });
      let body = null;
      try {
        body = await r.json();
      } catch {}
      return {
        status: r.status,
        got: body?.response?.results?.length ?? null,
        remaining: body?.response?.remaining ?? null,
        err: body?.body?.message ?? body?.message ?? null,
      };
    },
    { base: BASE },
  );
  console.log(`listing statistic-post?limit=5 -> ${JSON.stringify(listing)}`);
} finally {
  await browser.close();
}
