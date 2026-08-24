#!/usr/bin/env node
/**
 * The audio tracker's reader. Runs on a VPS, not on Vercel and not on a laptop.
 *
 * Two things have to be true of the machine this runs on, and neither is true
 * of a serverless function:
 *
 *   1. It can run a real browser. TikTok stopped server-rendering music pages;
 *      the use-count arrives from /api/music/detail/, which answers empty unless
 *      the request carries X-Bogus, X-Gnarly, X-Dynosaur and msToken. Those are
 *      produced by TikTok's own client script as a side effect of loading the
 *      page, and cannot be forged server-side.
 *   2. It is outside India, where tiktok.com serves a placeholder page and the
 *      app never boots -- so a browser there reads nothing either.
 *
 * It holds one token and talks to one endpoint. It never sees DATABASE_URL: the
 * app decides what a reading means (the delta, the velocity, the metadata
 * backfill) and this only reports the number, so the arithmetic cannot drift
 * into a second copy the way it has before.
 *
 * Usage:
 *   APP_URL=https://campaign.madeboring.com SOUND_INGEST_TOKEN=... node read-sounds.mjs
 *   ... --dry-run     read everything, write nothing
 */
import { fetchSoundStatsViaBrowser } from "../dev/tiktokSoundViaBrowser.mjs";

const APP_URL = (process.env.APP_URL ?? "").replace(/\/+$/, "");
const TOKEN = process.env.SOUND_INGEST_TOKEN ?? process.env.CRON_SECRET;
const DRY_RUN = process.argv.includes("--dry-run");
const INGEST = `${APP_URL}/api/trackers/sounds/ingest`;

if (!APP_URL || !TOKEN) {
  console.error("set APP_URL and SOUND_INGEST_TOKEN");
  process.exit(2);
}

const auth = { authorization: `Bearer ${TOKEN}` };
const started = Date.now();

/**
 * Every call to the app goes through here, because the interesting failure is
 * not an HTTP status -- it is the app being unreachable, and an unwrapped fetch
 * answers that by dumping an undici stack trace into the journal. A scheduled
 * job's log is read at the worst possible moment; it should say what is wrong in
 * its first line.
 */
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
    if (res.status === 401) console.error("  the token does not match SOUND_INGEST_TOKEN (or CRON_SECRET) on the app");
    process.exit(1);
  }
  return res;
}

/* Which sounds to read is the app's answer, not a list kept on this box: adding
   a sound in the UI is then enough to get it tracked. */
const listRes = await callApp({ headers: auth }, "list the tracked sounds");
const { sounds } = await listRes.json();
if (!sounds?.length) {
  console.log("no sounds are being tracked; nothing to do");
  process.exit(0);
}

const readings = [];
const failures = [];

for (const sound of sounds) {
  /* One retry, because a cold page that has not finished issuing its own API
     call is the common failure and it costs one more load to rule out. Anything
     past that is TikTok saying no, and hammering it is how a reader gets a box
     blocked. */
  let stats = null;
  for (let attempt = 1; attempt <= 2 && !stats; attempt += 1) {
    try {
      stats = await fetchSoundStatsViaBrowser(sound.tiktokSoundId, { timeoutMs: 60_000 });
    } catch (err) {
      if (attempt === 2) failures.push(`${sound.tiktokSoundId}: ${String(err).split("\n")[0].slice(0, 90)}`);
    }
  }

  if (!stats) {
    if (!failures.some((f) => f.startsWith(sound.tiktokSoundId))) {
      failures.push(`${sound.tiktokSoundId}: page gave no count`);
    }
    console.log(`  MISS  ${sound.tiktokSoundId}  ${sound.title ?? ""}`);
    continue;
  }

  readings.push({ tiktokSoundId: sound.tiktokSoundId, ...stats });
  console.log(`  ok    ${sound.tiktokSoundId}  uses=${stats.usesCount}  ${stats.title ?? sound.title ?? ""}`);
}

if (!readings.length) {
  /* Every page failing is the outage this job exists to notice. Exiting non-zero
     is what makes systemd's OnFailure, or a cron MAILTO, say so -- silence here
     is exactly how the tracker sat broken for weeks. */
  console.error(`read 0 of ${sounds.length} sounds:\n  ${failures.join("\n  ")}`);
  process.exit(1);
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
  `read ${readings.length}/${sounds.length} in ${secs}s -> recorded=${result.recorded} skipped=${result.skipped} unknown=${result.unknown}${DRY_RUN ? " (dry run)" : ""}`
);
/* Partial failure still exits non-zero: three of four sounds reading is a
   tracker that is quietly going blind on one, and it should be visible. */
if (failures.length) {
  console.error(`${failures.length} sound(s) could not be read:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
