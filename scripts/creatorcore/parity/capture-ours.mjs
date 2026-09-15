/**
 * The OUR-SIDE half of the parity capture.
 *
 * Lives in this directory deliberately: it imports probe.mjs, landmarks.mjs and
 * settle.mjs *verbatim* from the reference harness. The extraction, the derived
 * measurements and the hit-test are therefore literally the same function on
 * both sides -- only `side: "ours"` differs, which swaps the resolver. A
 * measurement bug cannot flatter one side of a diff computed by one function.
 *
 *   node scripts/creatorcore/parity/capture-ours.mjs [--viewport <id>] [--theme <t>]
 *                                                    [--base http://localhost:3011]
 *
 * Auth reuses the repo's own E2E trick (e2e/fixtures/auth.setup.ts): a NextAuth
 * JWT is encoded locally and injected as a cookie, so no login flow runs and no
 * credentials are typed into a page.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { LANDMARKS } from "./landmarks.mjs";
import { PROBE } from "./probe.mjs";
import { CENSUS } from "./census.mjs";
import { settle } from "./settle.mjs";
import { VIEWPORTS } from "./surfaces.mjs";


/* settle() waits for the DOM to go QUIET, and a loading skeleton is quiet: it
   is one static div whose shimmer is a CSS animation, so no MutationObserver
   ever fires while React is still awaiting data. MEASURED 2026-09-14 at
   tablet-768: seven campaign surfaces plus `payouts` reported settleMs ~1057
   and resolved 0 of 5 landmarks, and the saved viewport PNG is the skeleton --
   no title, no header strip, nothing to probe. The report counted them as
   "surfaces not measured (harness health < 60%)", which reads like a parity
   gap and is not one.

   So wait for the skeleton to GO, bounded, and then let settle() run again on
   the real content. The reference side needs none of this -- Bubble renders
   server-side and has no skeleton -- which is why this lives here and not in
   the shared settle.mjs. */
/* MEASURED: the class is `ui-skeleton`, from @pratham7711/ui -- the local
   components/ui/skeleton.tsx ([data-slot="skeleton"]) and the .cc-skeleton
   rule in globals.css are NOT what the campaign pages render, and a first
   pass that waited only on those cleared instantly and re-captured the same
   skeleton. Keep all four: they are the four skeleton vocabularies in the
   tree and any of them means the page is still loading. */
const SKELETON =
  '[class*="ui-skeleton"], [data-slot="skeleton"], .cc-skeleton, .skeleton';
async function awaitContent(page, budgetMs = 20_000) {
  try {
    await page.waitForFunction(
      (sel) => document.querySelectorAll(sel).length === 0,
      SKELETON,
      { timeout: budgetMs },
    );
  } catch {
    /* Still skeletal at the ceiling. Measure what is there; harness health
       reports the low resolution rate rather than silently dropping it. */
    return 0;
  }
  return settle(page);
}


const args = process.argv.slice(2);
const opt = (f, d) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : d);
const BASE = opt("--base", "http://localhost:3011");
const THEME = opt("--theme", "creatorcore");
const ONE_VIEWPORT = opt("--viewport", null);
const ONLY = opt("--only", null);

const env = readFileSync(".env.local", "utf8");
const SECRET = /^NEXTAUTH_SECRET=["']?([^"'\n]+)/m.exec(env)?.[1];
if (!SECRET) throw new Error("NEXTAUTH_SECRET not found in .env.local");

/* Same identity the E2E suite uses, so this measures the same seeded org. */
const { encode } = await import("next-auth/jwt");
const COOKIE = "authjs.session-token";
const token = await encode({
  token: {
    sub: "cmnbxspfv00016vfdz6yuds55",
    id: "cmnbxspfv00016vfdz6yuds55",
    email: "admin@demo.com",
    name: "Admin",
    orgId: "cmnbxsoos00006vfd7jhdvusb",
    role: "OWNER",
  },
  secret: SECRET,
  salt: COOKIE,
});

const NAV = [
  "dashboard", "campaigns", "creators", "clients", "analytics", "reports",
  "calendar", "deadlines", "inbox", "discovery", "lists", "media-kits",
  "payouts", "requests", "activations", "connections", "fan-pages",
  "financial-reports", "plans", "recipients", "audit-log",
];
const SETTINGS = [
  "general", "team", "billing", "notifications", "integrations", "api-keys",
  "profile", "ingestion",
];
const CAMPAIGN_SECTIONS = [
  "performance", "overview", "drafts", "posts", "creators", "reviews",
  "analytics", "financials", "documents", "edit",
];

/* --run-id writes into an existing run directory instead of minting a new one.
   Paired with --only, that re-measures one surface in place so score.py still
   sees all 23 and reports a whole-run number rather than a partial one. */
const runId =
  opt("--run-id", null) ||
  new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const RAW = path.join("scripts/creatorcore/out/parity-ours", runId);

const browser = await chromium.launch({ channel: "chrome" });
const index = [];
let captured = 0, failed = 0, campaignId = null;

for (const vp of VIEWPORTS) {
  if (ONE_VIEWPORT && vp.id !== ONE_VIEWPORT) continue;
  /* One context PER VIEWPORT, never setViewportSize on a live page: a resized
     page keeps its resize history and reports different numbers than a fresh
     load at the same width. Same rule the reference side obeys. */
  const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
  /* Playwright's default navigation timeout is 30s and the campaign-fixture
     probe below inherited it, while the surface loop beside it already passed
     60s -- an inconsistency worth removing on its own, so it is set once here
     and no navigation can inherit the short default.

     It is NOT what caused the 2026-09-14 run failures, and the first version of
     this comment said it was. Raising 30s to 120s changed nothing because the
     dev server was WEDGED: `curl` without -L returned its 302 in 14ms (that
     redirect is proxy.ts, which compiles no page), while `curl -L` on the same
     URL hung for the full 120s and the server logged not one line. Restarting
     the server fixed it -- /login then compiled and answered 200 in 2.1s.
     The lesson is the diagnostic, not the number: an instant 302 from a Next
     dev server proves only that middleware runs, so never read it as "the
     server is healthy". Follow the redirect before believing that. */
  ctx.setDefaultNavigationTimeout(120_000);
  await ctx.addCookies([
    { name: COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
  ]);
  const outDir = path.join(RAW, vp.id);
  mkdirSync(outDir, { recursive: true });
  console.log(`\n== ${vp.id} (${vp.width}x${vp.height}) theme=${THEME} ==`);

  if (!campaignId) {
    /* Retry, and shout if it still fails. A null here silently drops all ten
       campaign-* surfaces for THIS viewport while the run still prints
       "0 failed" -- measured: desktop-1600 captured 29 of 39 and reported clean,
       and because desktop-1600 is the viewport report.mjs compares, the parity
       number was computed on a short sample without saying so. A skip that reads
       as a success is worse than a failure. */
    const p = await ctx.newPage();
    const find = async () => {
      await p.goto(`${BASE}/campaigns`, { waitUntil: "domcontentloaded" });
      await settle(p);
      return p.evaluate(() => {
        const a = [...document.querySelectorAll('a[href^="/campaigns/"]')]
          .map((x) => x.getAttribute("href").split("/")[2])
          .filter((x) => x && x !== "self-serve");
        return a[0] ?? null;
      });
    };
    campaignId = await find();
    if (!campaignId) {
      console.log("   campaign fixture: none on first try, retrying once");
      await p.waitForTimeout(3000);
      campaignId = await find();
    }
    await p.close();
    if (!campaignId) {
      failed += CAMPAIGN_SECTIONS.length;
      console.log(
        `   !! campaign fixture NOT FOUND at ${vp.id} -- ${CAMPAIGN_SECTIONS.length} campaign surfaces skipped, counted as failures`,
      );
    } else {
      console.log(`   campaign fixture: ${campaignId}`);
    }
  }

  const surfaces = [
    ...NAV.map((n) => ({ id: `nav-${n}`, path: `/${n}`, shell: "dashboard", group: "nav" })),
    ...SETTINGS.map((t) => ({ id: `settings-${t}`, path: `/settings/${t}`, shell: "settings", group: "settings" })),
    ...(campaignId
      ? CAMPAIGN_SECTIONS.map((s) => ({
          id: `campaign-${s}`,
          path: `/campaigns/${campaignId}?section=${s}`,
          shell: "campaign",
          group: "campaign",
        }))
      : []),
  ];

  /* --only narrows the run to the surfaces whose id contains the string. A
     full pass is 23 surfaces and several minutes; when one surface is being
     iterated on, re-measuring the other 22 buys nothing and the census files
     for them are already on disk from the previous run. Absent the flag,
     everything runs, so the scored number is never accidentally partial. */
  const picked = ONLY ? surfaces.filter((s) => s.id.includes(ONLY)) : surfaces;
  if (ONLY) console.log(`   --only ${ONLY}: ${picked.length} of ${surfaces.length} surfaces`);

  for (const s of picked) {
    const page = await ctx.newPage();
    const rec = { surface: s.id, viewport: vp.id, group: s.group, path: s.path, theme: THEME, side: "ours" };
    try {
      /* Theme BEFORE first paint. A live class swap restyles paint but does not
         re-run mount-time layout decisions -- e2e/contrast.spec.ts:244 records
         that exact trap, which is why this is an init script and not a click. */
      await page.addInitScript((t) => {
        try { localStorage.setItem("theme", t); } catch {}
        document.addEventListener("DOMContentLoaded", () => {
          document.documentElement.classList.remove("light", "dark", "creatorcore");
          document.documentElement.classList.add(t);
        });
      }, THEME);
      await page.goto(BASE + s.path, { waitUntil: "domcontentloaded", timeout: 60_000 });
      rec.settleMs = await settle(page);
      rec.settleMs += await awaitContent(page);
      await page.evaluate((t) => {
        document.documentElement.classList.remove("light", "dark", "creatorcore");
        document.documentElement.classList.add(t);
      }, THEME);

      /* Drop the email-verification banner before measuring.

         This is an ACCOUNT-STATE element, not a layout one: it renders only
         because the seeded capture identity (admin@demo.com) has an unverified
         email, and the CreatorCore reference account is not in that state. So it
         has no counterpart on their side by construction.

         MEASURED 2026-09-14, and it is the reason this is worth doing rather
         than tolerating: the banner is 40.5px tall and sits ABOVE <main>, so it
         pushed every page landmark down by exactly that much. It accounted for
         1402px of 2409px -- 58% -- of all remaining vertical drift, and it read
         in the report as "our page header is 40px too low" across
         page.header-strip, page.title and page.primary-action at once. With it
         hidden our header lands at y=26 on campaigns, clients and activations,
         against the reference's 26: dY exactly 0.

         Nothing about the page's own layout changes -- --cc-page-pad-top
         (1.625vw = 26px at 1600) was already correct and already matched them.
         Measuring it was comparing our app in a transient state against a
         reference that never shows one, which is a fixture bug, not drift.

         Matched on the copy rather than a class because the element carries
         none; if that copy changes this stops matching and the banner returns to
         the measurement, which is the safe direction to fail. */
      rec.verifyBannerHidden = await page.evaluate(() => {
        const dc = document.querySelector(".cc-dashboard-content");
        if (!dc) return false;
        const ban = [...dc.children].find(
          (c) => /Confirm .* so we know this address reaches you/i.test(c.textContent || ""));
        if (!ban) return false;
        ban.style.display = "none";
        return true;
      });

      const probe = await page.evaluate(PROBE, { landmarks: LANDMARKS, shellHint: s.shell, side: "ours" });
      rec.health = probe.health;
      rec.landmarks = probe.landmarks;

      /* The census is taken at rest, before any screenshot scrolls anything. */
      const census = await page.evaluate(CENSUS);
      rec.censusCounts = census.counts;

      const base = path.join(outDir, s.id);
      writeFileSync(`${base}.census.json`, JSON.stringify(census));
      await page.screenshot({ path: `${base}.full.png`, fullPage: true });
      await page.screenshot({ path: `${base}.viewport.png` });
      rec.screenshots = [`${s.id}.full.png`, `${s.id}.viewport.png`];
      writeFileSync(`${base}.landmarks.json`, JSON.stringify(rec, null, 2));

      captured++;
      const h = rec.health;
      const na = h.notApplicable ? ` (+${h.notApplicable} n/a)` : "";
      console.log(`  ok ${s.id.padEnd(24)} ${h.shell.padEnd(9)} ${h.resolved}/${h.applicable}${na}  ${rec.settleMs}ms`);
    } catch (err) {
      failed++;
      rec.error = String(err.message || err).split("\n")[0];
      console.log(`  FAIL ${s.id.padEnd(24)} ${rec.error.slice(0, 80)}`);
    } finally {
      index.push(rec);
      await page.close();
    }
  }
  await ctx.close();
}

writeFileSync(path.join(RAW, "index.json"), JSON.stringify({ runId, base: BASE, theme: THEME, captured, failed, index }, null, 2));
await browser.close();
console.log(`\n${captured} ok / ${failed} failed -> ${RAW}`);
