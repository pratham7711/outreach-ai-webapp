/**
 * Page benchmark: every main screen, loaded and then used, scored against
 * published budgets.
 *
 *   PORT=3021 THEME=light node scripts/perf/bench.mjs [--json <path>]
 *
 * Budgets (sources in docs/RENDER_PERFORMANCE.md):
 *   LCP <= 2500ms, INP <= 200ms, CLS <= 0.1   Core Web Vitals "good"
 *   FCP <= 1800ms, TTFB <= 800ms              web.dev
 *   TBT <= 200ms                              Lighthouse, mobile "good"
 *   no long task > 50ms while interacting     RAIL
 *
 * Lab profile: CPU slowed 4x (CPU=), 40ms RTT (RTT=), 10 Mbps (KBPS=). Point
 * PORT at scripts/perf/gzproxy.mjs, not at `next start` directly, or transfer
 * sizes are uncompressed and LCP reads slow for a reason prod does not have.
 *
 * Needs a production build (`next build` + `next start`) on the throwaway
 * database scripts/perf/seed.mjs fills, and the e2e login state in
 * e2e/fixtures/.auth.json (any Playwright run writes it). ONLY=<regex> limits
 * the pages; THEME= is light, dark or creatorcore.
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const AUTH = path.join(ROOT, "e2e", "fixtures", ".auth.json");
const WV = fs.readFileSync(path.join(ROOT, "node_modules/next/dist/compiled/web-vitals/web-vitals.js"), "utf8");

const port = process.env.PORT || 3021;
const theme = process.env.THEME || "light";
const CPU = Number(process.env.CPU || 4);
const RTT = Number(process.env.RTT || 40);
const KBPS = Number(process.env.KBPS || 10240);
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
const args = process.argv.slice(2);
const jsonOut = args.includes("--json") ? args[args.indexOf("--json") + 1] : null;

if (!fs.existsSync(AUTH)) {
  console.error("no e2e/fixtures/.auth.json: run any Playwright spec once to write it");
  process.exit(2);
}

const SEARCH = 'main input[placeholder*="earch" i]';
const type = (txt) => async (p) => {
  const el = p.locator(SEARCH).first();
  if (!(await el.count())) return "no search";
  await el.click();
  await p.keyboard.type(txt, { delay: 150 });
  await p.waitForTimeout(1500);
};
const click = (loc) => async (p) => {
  const l = loc(p);
  if (!(await l.count())) return "no target";
  await l.first().click();
  await p.waitForTimeout(1200);
};
const seq = (...steps) => async (p) => {
  const notes = [];
  for (const step of steps) {
    const n = await step(p);
    if (n) notes.push(n);
  }
  return notes.join(",") || undefined;
};

const PAGES = [
  ["/dashboard", null],
  ["/campaigns", seq(type("perf 1"), click((p) => p.getByRole("tab", { name: /^Complete/ })))],
  ["/campaigns/perf-big", seq(click((p) => p.getByRole("link", { name: /^Posts/ })), click((p) => p.getByRole("link", { name: /^Creators/ })))],
  ["/campaigns/perf-big?section=posts", seq(type("perf_c"), click((p) => p.getByRole("button", { name: "List view" })), click((p) => p.locator("button.cc-microlabel", { hasText: /^Views$/ })))],
  ["/campaigns/perf-big?section=creators", type("creator 1")],
  ["/campaigns/perf-big?section=performance", null],
  ["/campaigns/perf-big?section=analytics", null],
  ["/campaigns/perf-big?section=edit", click((p) => p.locator("#edit-campaign-title"))],
  ["/creators", seq(type("perf creator"), click((p) => p.getByRole("button", { name: "Table view" })), click((p) => p.locator("tbody tr input[type=checkbox]")))],
  ["/creators/perf-cr-0", null],
  ["/trackers", null],
  ["/trackers?sub=creator", type("creator")],
  ["/lists", null],
  ["/lists/perf-list", null],
  ["/analytics", seq(click((p) => p.getByRole("group", { name: "Date range" }).getByRole("button", { name: "All", exact: true })), click((p) => p.getByRole("tab", { name: /Creators/ })))],
  ["/calendar", null],
  ["/songs", null],
  ["/payouts", null],
  ["/settings", null],
  ["/settings/team", null],
  ["/settings/trackers", null],
];

const browser = await chromium.launch({ channel: "chrome" });
const rows = [];
for (const [route, act] of PAGES) {
  if (ONLY && !ONLY.test(route)) continue;
  const ctx = await browser.newContext({ storageState: AUTH, baseURL: `http://localhost:${port}`, viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript((t) => {
    try {
      localStorage.setItem("theme", t);
    } catch {}
  }, theme);
  // Next ships web-vitals as a CommonJS bundle that reads __dirname.
  await ctx.addInitScript(
    `(function(){try{var __dirname="/";var module={exports:{}};${WV};window.__wvlib=module.exports;}catch(e){window.__wverr=String(e)}})();`,
  );
  await ctx.addInitScript(() => {
    const M = (window.__m = { lcp: null, cls: 0, fcp: null, ttfb: null, inpWV: null, lt: [], ev: new Map() });
    const w = window.__wvlib;
    if (w) {
      w.onLCP((m) => (M.lcp = m.value), { reportAllChanges: true });
      w.onCLS((m) => (M.cls = m.value), { reportAllChanges: true });
      w.onFCP((m) => (M.fcp = m.value));
      w.onTTFB((m) => (M.ttfb = m.value));
      w.onINP((m) => (M.inpWV = m.value), { reportAllChanges: true });
    }
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) M.lt.push([e.startTime, e.duration]);
    }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (e.interactionId) M.ev.set(e.interactionId, Math.max(M.ev.get(e.interactionId) || 0, e.duration));
    }).observe({ type: "event", buffered: true, durationThreshold: 16 });
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (CPU > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: RTT,
    downloadThroughput: (KBPS * 1024) / 8,
    uploadThroughput: (KBPS * 1024) / 8,
  });
  let note = "";
  try {
    await page.goto(route, { waitUntil: "load", timeout: 60000 });
    await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
    await page
      .waitForFunction(() => document.querySelectorAll(".ui-skeleton").length === 0, null, { timeout: 30000 })
      .catch(() => (note += "skeleton-stuck "));
    await page.waitForTimeout(2500);
    const loadEnd = await page.evaluate(() => performance.now());
    const pre = await page.evaluate(() => ({ lcp: window.__m.lcp, fcp: window.__m.fcp, ttfb: window.__m.ttfb }));
    if (act) {
      const n = await act(page);
      if (n) note += n;
    }
    await page.waitForTimeout(800);
    const m = await page.evaluate((loadEnd) => {
      const M = window.__m;
      const fcp = M.fcp ?? 0;
      const tbt = M.lt.filter(([s]) => s >= fcp && s <= loadEnd).reduce((a, [, d]) => a + Math.max(0, d - 50), 0);
      return {
        cls: M.cls,
        inp: Math.max(0, ...M.ev.values()),
        inpWV: M.inpWV,
        tbt,
        ltLoadMax: Math.max(0, ...M.lt.filter(([s]) => s <= loadEnd).map(([, d]) => d)),
        ltInteractMax: Math.max(0, ...M.lt.filter(([s]) => s > loadEnd).map(([, d]) => d)),
        interactions: M.ev.size,
      };
    }, loadEnd);
    rows.push({ path: route, ...pre, ...m, note: note.trim() });
  } catch (e) {
    rows.push({ path: route, note: "ERR " + String(e).split("\n")[0].slice(0, 100) });
  }
  await ctx.close();
}
await browser.close();

const R = (v) => (v == null ? "  —" : Math.round(v));
const flag = (v, lim) => (v == null || v <= lim ? " " : "✗");
console.log(`port ${port} theme ${theme} cpu ${CPU}x rtt ${RTT}ms ${KBPS}kbps`);
console.log("page".padEnd(42) + "TTFB   FCP    LCP    CLS     TBT  longLoad  INP  longInteract  n");
for (const r of rows) {
  if (r.note?.startsWith("ERR")) {
    console.log(r.path.padEnd(42) + r.note);
    continue;
  }
  console.log(
    r.path.padEnd(42) +
      `${String(R(r.ttfb)).padStart(4)}${flag(r.ttfb, 800)} ${String(R(r.fcp)).padStart(5)}${flag(r.fcp, 1800)} ` +
      `${String(R(r.lcp)).padStart(5)}${flag(r.lcp, 2500)} ${r.cls.toFixed(3).padStart(6)}${flag(r.cls, 0.1)} ` +
      `${String(R(r.tbt)).padStart(5)}${flag(r.tbt, 200)} ${String(R(r.ltLoadMax)).padStart(6)}  ` +
      `${String(R(r.inp)).padStart(5)}${flag(r.inp, 200)} ${String(R(r.ltInteractMax)).padStart(6)}${flag(r.ltInteractMax, 50)}  ` +
      `${r.interactions} ${r.note || ""}`,
  );
}
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(rows, null, 1));
