#!/usr/bin/env node
/**
 * The creator tracker's grid reader. Runs on a VPS with real Chrome, not on
 * Vercel and not on a laptop in India.
 *
 * Three things have to be true of the machine, and no serverless function has
 * all of them:
 *
 *   1. It can run REAL Chrome. /api/post/item_list/ is signed by TikTok's
 *      client script, which refuses to produce the tokens under headless
 *      SwiftShader Chromium — measured from a Vercel Sandbox with clean US
 *      egress: full page, rehydration blob present, grid never fires.
 *   2. It is outside India, where tiktok.com serves a placeholder and the app
 *      never boots.
 *   3. It has an egress IP TikTok will serve profile pages to (any ordinary
 *      VPS in the US or EU has, on current measurements).
 *
 * Same contract as the sound worker: one token, one endpoint, no DATABASE_URL.
 * The app decides what a post list means (ranking, the six kept, never
 * overwriting stored posts with an empty read); this box only reads and posts.
 *
 * Usage:
 *   APP_URL=https://campaign.madeboring.com CREATOR_INGEST_TOKEN=... node read-top-posts.mjs
 *   ... --dry-run     read everything, write nothing
 *   ... --headed      run Chrome with a window (needs xvfb-run on a server)
 */
import { fetchTopPostsViaBrowser, launchRealChrome } from "../dev/tiktokTopPostsViaBrowser.mjs";

const APP_URL = (process.env.APP_URL ?? "").replace(/\/+$/, "");
const TOKEN =
  process.env.CREATOR_INGEST_TOKEN ?? process.env.SOUND_INGEST_TOKEN ?? process.env.CRON_SECRET;
const DRY_RUN = process.argv.includes("--dry-run");
const HEADED = process.argv.includes("--headed");
const INGEST = `${APP_URL}/api/trackers/creators/ingest`;

if (!APP_URL || !TOKEN) {
  console.error("set APP_URL and CREATOR_INGEST_TOKEN");
  process.exit(2);
}

const auth = { authorization: `Bearer ${TOKEN}` };
const started = Date.now();

/** Same fail-fast as the sound worker, for the same measured reason: from an
    Indian IP every read fails by TIMING OUT, which at a minute a page reads as
    an outage rather than a placement problem. */
async function assertEgressOutsideIndia() {
  if (process.env.SKIP_EGRESS_CHECK === "1") {
    console.warn("egress check skipped (SKIP_EGRESS_CHECK=1)");
    return;
  }
  let country = null;
  try {
    const res = await fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(8000) });
    if (res.ok) country = (await res.json())?.country ?? null;
  } catch {
    console.warn("could not determine egress country; continuing");
    return;
  }
  if (country === "IN") {
    console.error(
      "refusing to run: egress is India (IN), where tiktok.com serves a placeholder and every read times out.\n" +
        "  Run this on a host outside India, then try again.\n" +
        "  Override with SKIP_EGRESS_CHECK=1 if you know better."
    );
    process.exit(3);
  }
  console.log(`egress country: ${country ?? "unknown"}`);
}

await assertEgressOutsideIndia();

async function callApp(init, what) {
  let res;
  try {
    res = await fetch(INGEST, init);
  } catch (err) {
    const cause = err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(err);
    console.error(`could not reach ${APP_URL} to ${what}: ${String(cause).slice(0, 120)}`);
    process.exit(1);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error(`app refused to ${what}: HTTP ${res.status} ${body.slice(0, 200)}`);
    if (res.status === 401)
      console.error("  the token does not match CREATOR_INGEST_TOKEN (or SOUND_INGEST_TOKEN / CRON_SECRET) on the app");
    process.exit(1);
  }
  return res;
}

/* Which creators to read is the app's answer: tracking one in the UI is enough
   to get their grid read on the next timer. */
const listRes = await callApp({ headers: auth }, "list the tracked creators");
const { creators } = await listRes.json();
if (!creators?.length) {
  console.log("no TikTok creators are being tracked; nothing to do");
  process.exit(0);
}

/* One browser for the whole run. Real Chrome does not have the sound worker's
   single-process wedge, but a launch per creator would still spend ~3s each
   for nothing. */
const browser = await launchRealChrome({ headless: !HEADED });

const readings = [];
const stale = [];
const regressed = [];

try {
  for (const creator of creators) {
    /* One retry — a cold page whose grid XHR has not fired yet is the common
       failure and costs one more load to rule out. Past that, TikTok said no. */
    let read = null;
    let why = "page gave no posts";
    for (let attempt = 1; attempt <= 2 && !read?.posts?.length; attempt += 1) {
      try {
        read = await fetchTopPostsViaBrowser(browser, creator.handle, { timeoutMs: 60_000 });
      } catch (err) {
        why = String(err).split("\n")[0].slice(0, 110);
      }
    }

    if (!read?.posts?.length) {
      const note = `@${creator.handle}: ${why}`;
      (creator.readRecently ? regressed : stale).push(note);
      console.log(`  ${creator.readRecently ? "LOST" : "skip"}  @${creator.handle}  ${creator.name ?? ""}`);
      continue;
    }

    readings.push({ creatorId: creator.id, posts: read.posts.slice(0, 60) });
    const top = read.posts.reduce((a, b) => ((b.views ?? 0) > (a.views ?? 0) ? b : a));
    console.log(`  ok    @${creator.handle}  posts=${read.posts.length}  topViews=${top.views ?? "?"}`);
  }
} finally {
  await browser.close().catch(() => {});
}

/** Only a creator whose grid used to read and has stopped moves the exit code:
    an alert that fires on every run is the same as no alert. */
function finish() {
  if (stale.length) {
    console.warn(
      `${stale.length} creator(s) had no recent read to lose -- rows to look at, not an outage to chase:\n  ${stale.join("\n  ")}`
    );
  }
  if (regressed.length) {
    console.error(`${regressed.length} creator(s) stopped reading:\n  ${regressed.join("\n  ")}`);
    process.exit(1);
  }
  process.exit(0);
}

if (!readings.length) {
  console.log(`read 0 of ${creators.length} creators`);
  finish();
}

const postRes = await callApp(
  {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ readings, dryRun: DRY_RUN }),
  },
  "record the readings"
);
const result = await postRes.json().catch(() => ({}));

const secs = ((Date.now() - started) / 1000).toFixed(1);
console.log(
  `read ${readings.length}/${creators.length} in ${secs}s -> recorded=${result.recorded} unknown=${result.unknown}${DRY_RUN ? " (dry run)" : ""}`
);
finish();
