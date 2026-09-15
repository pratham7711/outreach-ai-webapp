/**
 * Captures every reference surface at every viewport: screenshots + measurements.
 *
 *   node scripts/creatorcore/parity/capture.mjs [--only <substr>] [--viewport <id>] [--no-redact] [--fresh]
 *
 * READ-ONLY against the reference org. The only clicks are navigation, and this
 * file performs none at all -- every surface is reached by URL.
 *
 * One BrowserContext per viewport, each loaded fresh: app/globals.css:1656-1666
 * records that resizing a live Bubble page gives different numbers, because its
 * responsive groups keep resize history. `page.setViewportSize` is therefore
 * never called here, and preflight.mjs fails the run if it appears.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { ensureSession, STATE_FILE, waitForAppReady } from "./auth.mjs";
import { loadSecrets, refUrl, maskEmail } from "./secrets.mjs";
import { buildSurfaces, VIEWPORTS } from "./surfaces.mjs";
import { LANDMARKS } from "./landmarks.mjs";
import { PROBE } from "./probe.mjs";
import { CENSUS } from "./census.mjs";
import { REDACT_SCRIPT } from "./redact.mjs";
import { settle } from "./settle.mjs";

/* The reference keeps navigating AFTER waitForAppReady and settle both report
   quiet -- MEASURED 2026-09-14 at tablet-768, where 5 of 45 surfaces died with
   "Execution context was destroyed" or a createTreeWalker TypeError on a null
   document.body (the same event, seen a moment earlier). Both mean the page
   moved under the probe, which is a reason to MEASURE AGAIN, not to record a
   failed surface: a surface dropped here is silently missing from the diff,
   which reads as parity rather than as a gap. Re-settle and retry; only a
   third consecutive move is a real failure. */
/* CreatorCore shows a full-screen notice on PHONE widths and nothing behind it
   is the page. MEASURED 2026-09-14 on the reference at 390: a Bubble `.greyout`
   node, position fixed, z-index 2002, background rgb(31,60,239), is the element
   returned by elementFromPoint at the viewport centre, with a "Continue" button
   floating above it. Ten of the 45 mobile surfaces captured through it --
   activations, calendar, clients, connections, discovery, payouts, recipients,
   requests, trackers-creator, trackers-sound -- and their landmarks recorded
   hit:"occluded" with the geometry of the blocked layout. That geometry then
   drove real findings: `recipients` list.rows read 177px tall against our 130,
   and `calendar` page.title read 202.3px wide, both measured off a page nobody
   can see. Tuning our CSS to match those numbers would have been tuning to a
   modal.

   So dismiss it and capture the page underneath. Clicking "Continue" on an
   informational notice is what any visitor does; it submits no form and writes
   no data, which keeps the read-only rule on this account intact. The greyout
   NODE survives the click (Bubble leaves it in the DOM, inert), so the exit
   test is whether it still answers elementFromPoint at the centre -- not
   whether it was removed. Silent no-op when there is no interstitial, which is
   every desktop and tablet surface. */
async function dismissInterstitial(page) {
  const blocked = () =>
    page.evaluate(() => {
      const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return !!el?.closest(".greyout");
    }).catch(() => false);
  if (!(await blocked())) return false;
  const btn = page.getByRole("button", { name: /^\s*Continue\s*$/ }).first();
  try {
    await btn.click({ timeout: 5_000 });
  } catch {
    return false;
  }
  await page
    .waitForFunction(() => {
      const el = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
      return !el?.closest(".greyout");
    }, null, { timeout: 10_000 })
    .catch(() => {});
  await settle(page);
  return true;
}

const NAVIGATED = /Execution context was destroyed|document\.body|Cannot find context|frame was detached/i;
async function evalStable(page, fn, arg, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      return await page.evaluate(fn, arg);
    } catch (e) {
      if (!NAVIGATED.test(e.message)) throw e;
      last = e;
      await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => {});
      await settle(page);
    }
  }
  throw last;
}

const HERE = import.meta.dirname;
const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);

const REDACT = !flag("--no-redact");
const ONLY = opt("--only", null);
const ONE_VIEWPORT = opt("--viewport", null);

const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const RAW = path.join(HERE, "..", "out", "parity", runId);

const fixtures = JSON.parse(readFileSync(path.join(HERE, "fixtures.json"), "utf8"));
let surfaces = buildSurfaces(fixtures);
if (ONLY) surfaces = surfaces.filter((s) => s.id.includes(ONLY));
let viewports = VIEWPORTS;
if (ONE_VIEWPORT) viewports = viewports.filter((v) => v.id === ONE_VIEWPORT);

const { baseUrl, email } = loadSecrets();
const progressFile = path.join(RAW, "progress.json");
mkdirSync(RAW, { recursive: true });

/** A landmark that moves under redaction makes the screenshot useless as a
 *  layout reference, so the redaction is rejected rather than the shot kept. */
const REDACTION_TOLERANCE_PX = 2;
function redactionShifted(before, after) {
  const moved = [];
  for (const [id, b] of Object.entries(before.landmarks)) {
    const a = after.landmarks[id];
    if (!b.rect || !a?.rect) continue;
    const d = Math.max(Math.abs(a.rect.x - b.rect.x), Math.abs(a.rect.y - b.rect.y),
                       Math.abs(a.rect.w - b.rect.w), Math.abs(a.rect.h - b.rect.h));
    if (d > REDACTION_TOLERANCE_PX) moved.push({ id, delta: +d.toFixed(1) });
  }
  return moved;
}

const browser = await chromium.launch({ headless: true, channel: "chrome" });
const index = [];
let captured = 0, failed = 0;

try {
  await ensureSession(browser);
  console.log(`[run] ${runId}  account=${maskEmail(email)}  surfaces=${surfaces.length} viewports=${viewports.length}`);
  console.log(`[run] browser=chrome ${browser.version()}  (same channel as playwright.config.ts, so both sides of the diff measure on one build)`);

  for (const vp of viewports) {
    const options = {
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2,
      isMobile: vp.kind === "mobile",
      hasTouch: vp.kind === "mobile",
    };
    const ref = { options, context: await browser.newContext({ ...options, storageState: STATE_FILE }) };
    const outDir = path.join(RAW, vp.id);
    mkdirSync(outDir, { recursive: true });
    console.log(`\n=== ${vp.id} (${vp.width}x${vp.height}) ===`);

    for (const s of surfaces) {
      const page = await ref.context.newPage();
      const rec = { surface: s.id, viewport: vp.id, group: s.group, path: s.path };
      try {
        await page.goto(refUrl(baseUrl, s.path), { waitUntil: "domcontentloaded", timeout: 60_000 });
        rec.readyBy = await waitForAppReady(page, 45_000);
        rec.settleMs = await settle(page);
        rec.interstitialDismissed = await dismissInterstitial(page);

        const before = await evalStable(page, PROBE, { landmarks: LANDMARKS, shellHint: s.shell });
        rec.health = before.health;
        rec.landmarks = before.landmarks;

        if (REDACT) {
          rec.redaction = await evalStable(page, REDACT_SCRIPT, undefined);
          const after = await evalStable(page, PROBE, { landmarks: LANDMARKS, shellHint: s.shell });
          const moved = redactionShifted(before, after);
          rec.redactionShifted = moved;
          rec.redactionAccepted = moved.length === 0;
        } else {
          rec.redactionAccepted = false;
          rec.redaction = null;
        }

        /* AFTER the redaction, never before: the census records visible text
           verbatim, and their creators' handles and the org's money are exactly
           what docs/CREATORCORE_UI_INVENTORY.md is gitignored for. Post-redaction
           the chrome -- labels, headings, column names, tab names -- is intact
           and that is the whole of what the diff matches on. */
        const census = await evalStable(page, CENSUS, undefined);
        rec.censusCounts = census.counts;

        const base = path.join(outDir, s.id);
        writeFileSync(`${base}.census.json`, JSON.stringify(census));
        if (!REDACT || rec.redactionAccepted) {
          await page.screenshot({ path: `${base}.full.png`, fullPage: true });
          await page.screenshot({ path: `${base}.viewport.png` });
          rec.screenshots = [`${s.id}.full.png`, `${s.id}.viewport.png`];
        } else {
          rec.screenshots = [];
          console.log(`    ! ${s.id}: redaction moved ${rec.redactionShifted.length} landmark(s) -- screenshot withheld`);
        }
        writeFileSync(`${base}.landmarks.json`, JSON.stringify(rec, null, 2));

        captured++;
        const h = rec.health;
        const na = h.notApplicable ? ` (+${h.notApplicable} n/a)` : "";
        const ov = rec.interstitialDismissed ? "  [interstitial dismissed]" : "";
        console.log(
          `  ok ${s.id.padEnd(32)} ${h.shell.padEnd(9)} ${h.resolved}/${h.applicable}${na}  ${rec.settleMs}ms${ov}`
        );
      } catch (err) {
        failed++;
        rec.error = String(err.message || err).split("\n")[0];
        console.log(`  FAIL ${s.id.padEnd(32)} ${rec.error.slice(0, 80)}`);
      } finally {
        index.push(rec);
        await page.close();
        writeFileSync(progressFile, JSON.stringify({ runId, captured, failed, index }, null, 2));
      }
    }
    await ref.context.close();
  }

  writeFileSync(path.join(RAW, "index.json"), JSON.stringify({
    runId,
    browser: `chrome ${browser.version()}`,
    baseUrl,
    account: maskEmail(email),
    redacted: REDACT,
    viewports: viewports.map((v) => v.id),
    captured, failed,
    surfaces: index,
  }, null, 2));

  console.log(`\n[done] ${captured} captured, ${failed} failed`);
  console.log(`[raw ] ${RAW}`);
} finally {
  await browser.close();
}
