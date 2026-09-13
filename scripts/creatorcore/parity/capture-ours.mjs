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
import { settle } from "./settle.mjs";
import { VIEWPORTS } from "./surfaces.mjs";

const args = process.argv.slice(2);
const opt = (f, d) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : d);
const BASE = opt("--base", "http://localhost:3011");
const THEME = opt("--theme", "creatorcore");
const ONE_VIEWPORT = opt("--viewport", null);

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

const runId = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
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
  await ctx.addCookies([
    { name: COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" },
  ]);
  const outDir = path.join(RAW, vp.id);
  mkdirSync(outDir, { recursive: true });
  console.log(`\n== ${vp.id} (${vp.width}x${vp.height}) theme=${THEME} ==`);

  if (!campaignId) {
    const p = await ctx.newPage();
    await p.goto(`${BASE}/campaigns`, { waitUntil: "domcontentloaded" });
    await settle(p);
    campaignId = await p.evaluate(() => {
      const a = [...document.querySelectorAll('a[href^="/campaigns/"]')]
        .map((x) => x.getAttribute("href").split("/")[2])
        .filter((x) => x && x !== "self-serve");
      return a[0] ?? null;
    });
    await p.close();
    console.log(`   campaign fixture: ${campaignId ?? "NONE FOUND"}`);
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

  for (const s of surfaces) {
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
      await page.evaluate((t) => {
        document.documentElement.classList.remove("light", "dark", "creatorcore");
        document.documentElement.classList.add(t);
      }, THEME);

      const probe = await page.evaluate(PROBE, { landmarks: LANDMARKS, shellHint: s.shell, side: "ours" });
      rec.health = probe.health;
      rec.landmarks = probe.landmarks;

      const base = path.join(outDir, s.id);
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
