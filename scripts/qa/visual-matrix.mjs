/**
 * The visual matrix (plan §04 "How superb in every theme is checked"): every
 * kept page × 3 themes × 1440 / 390 px, against a running local server.
 *
 *   node scripts/qa/visual-matrix.mjs --out <dir> [--base http://localhost:3009] [--pages a,b] [--no-axe]
 *
 * Per cell it writes a screenshot and measures three things in the page:
 *   - layout: horizontal page scroll, boxes running off the right edge, and
 *     text cut off without an ellipsis;
 *   - axe-core (already in node_modules through eslint-plugin-jsx-a11y): the
 *     serious and critical violations, WCAG 2 A/AA;
 *   - keyboard focus: the first few Tab stops must draw an outline or a ring.
 * Then it writes results.json and a contact sheet, index.html, to --out.
 *
 * Signs in with the cookie e2e/fixtures/auth.setup.ts writes, so run the e2e
 * setup (or any e2e area) once first, against a server using the same
 * NEXTAUTH_SECRET.
 */
import { chromium, request } from "@playwright/test";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const BASE = arg("base", "http://localhost:3009");
const OUT = path.resolve(arg("out", path.join(ROOT, "docs", "qa", "matrix")));
const AXE = !argv.includes("--no-axe");

export const PAGES = [
  "/dashboard",
  "/campaigns",
  "/campaigns/camp-1",
  "/campaigns/camp-1?tab=posts",
  "/creators",
  "/creators/creator-1",
  "/trackers",
  "/lists",
  "/songs",
  "/calendar",
  "/analytics",
  "/settings",
  "/settings/general",
  "/settings/team",
  "/settings/trackers",
  "/settings/api-keys",
  "/settings/ingestion",
  "/admin",
  "/plans",
  "/platform",
  "/platform/trackers",
  "/platform/ops",
];
/* --portal: the creator app, signed in as the seeded creator -- the session
   e2e/fixtures/portal-auth.setup.ts writes to e2e/fixtures/.portal-auth.json.
   PORTAL_EMAIL and PORTAL_PASSWORD, when both are set, sign in afresh instead. */
export const PORTAL_PAGES = [
  "/portal/dashboard",
  "/portal/campaigns",
  "/portal/campaigns?tab=invited",
  "/portal/campaigns?tab=open",
  "/portal/accounts",
  "/portal/stats",
  "/portal/account",
  // Parked screens (K7): each should land back on Home.
  "/portal/messages",
  "/portal/earnings",
];
const PORTAL = argv.includes("--portal");
const pages = arg("pages") ? arg("pages").split(",") : PORTAL ? PORTAL_PAGES : PAGES;
const THEMES = ["light", "dark"];
const WIDTHS = [
  { name: "1440", width: 1440, height: 900 },
  { name: "390", width: 390, height: 844 },
];

const slug = (p) => p.replace(/^\//, "").replace(/[/?=&]+/g, "_") || "root";

function probeLayout() {
  const vw = window.innerWidth;
  const doc = document.documentElement;
  const scrollsSideways = (el) => {
    for (let n = el.parentElement; n; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX;
      if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
    }
    return false;
  };
  const label = (el) =>
    el.tagName.toLowerCase() +
    (el.id ? `#${el.id}` : "") +
    (typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "");
  const offRight = [];
  const clipped = [];
  for (const el of Array.from(document.querySelectorAll("body *"))) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    /* Visually hidden on purpose (.sr-only, the skip link): a 1px box with
       its text clipped is the technique, not a defect. */
    if (r.width <= 1 && r.height <= 1) continue;
    if (r.right > vw + 1 && !scrollsSideways(el)) offRight.push(`${label(el)} right=${Math.round(r.right)}`);
    const ownText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && (n.textContent || "").trim());
    if (
      ownText &&
      (cs.overflowX === "hidden" || cs.overflow === "hidden") &&
      cs.textOverflow !== "ellipsis" &&
      el.scrollWidth > el.clientWidth + 1
    ) {
      clipped.push(`${label(el)} "${(el.textContent || "").trim().slice(0, 40)}"`);
    }
  }
  return {
    pageScrollsSideways: doc.scrollWidth > vw + 1,
    scrollWidth: doc.scrollWidth,
    offRight: offRight.slice(0, 8),
    offRightCount: offRight.length,
    clipped: clipped.slice(0, 8),
    clippedCount: clipped.length,
  };
}

async function focusRing(page) {
  const seen = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    seen.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const cs = getComputedStyle(el);
        const ring =
          (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
          (cs.boxShadow && cs.boxShadow !== "none");
        return { el: el.tagName.toLowerCase() + (el.getAttribute("aria-label") ? `[${el.getAttribute("aria-label")}]` : ""), ring: Boolean(ring) };
      })
    );
  }
  const stops = seen.filter(Boolean);
  return { stops: stops.length, withoutRing: stops.filter((s) => !s.ring).map((s) => s.el) };
}

async function runAxe(page) {
  await page.addScriptTag({ path: path.join(ROOT, "node_modules", "axe-core", "axe.min.js") });
  return page.evaluate(async () => {
    const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] }, resultTypes: ["violations"] });
    return r.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, sample: v.nodes[0]?.target?.join(" ") ?? "" }));
  });
}

async function settle(page) {
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page
    .waitForFunction(() => document.querySelectorAll(".ui-skeleton").length === 0, null, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(300);
}

async function main() {
  const authFile = path.join(ROOT, "e2e", "fixtures", PORTAL ? ".portal-auth.json" : ".auth.json");
  if (PORTAL && process.env.PORTAL_EMAIL && process.env.PORTAL_PASSWORD) {
    const api = await request.newContext({ baseURL: BASE });
    const res = await api.post("/api/portal/auth/login", {
      data: { email: process.env.PORTAL_EMAIL, password: process.env.PORTAL_PASSWORD },
      timeout: 60000,
    });
    if (!res.ok()) throw new Error(`portal login failed: ${res.status()}`);
    writeFileSync(authFile, JSON.stringify(await api.storageState(), null, 2));
    await api.dispose();
  }
  if (!existsSync(authFile)) throw new Error(`${path.relative(ROOT, authFile)} is missing -- run the e2e auth setup first`);
  mkdirSync(path.join(OUT, "shots"), { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  const results = [];
  try {
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({
        viewport: { width: w.width, height: w.height },
        storageState: JSON.parse(readFileSync(authFile, "utf8")),
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      for (const theme of THEMES) {
        for (const p of pages) {
          const cell = { page: p, theme, width: w.name };
          try {
            await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
            await page.evaluate((t) => {
              localStorage.setItem("theme", t);
              document.documentElement.classList.remove("light", "dark");
              if (t !== "light") document.documentElement.classList.add(t);
            }, theme);
            const res = await page.reload({ waitUntil: "domcontentloaded" });
            cell.status = res?.status() ?? null;
            await settle(page);
            cell.finalPath = new URL(page.url()).pathname;
            const file = `shots/${slug(p)}__${theme}__${w.name}.jpg`;
            await page.screenshot({ path: path.join(OUT, file), fullPage: true, type: "jpeg", quality: 62 });
            cell.shot = file;
            cell.layout = await page.evaluate(probeLayout);
            if (AXE && theme !== "dark") cell.axe = await runAxe(page);
            cell.focus = await focusRing(page);
          } catch (e) {
            cell.error = e instanceof Error ? e.message.split("\n")[0] : String(e);
          }
          results.push(cell);
          process.stdout.write(
            `${w.name} ${theme.padEnd(11)} ${p.padEnd(28)} ${cell.error ? "ERROR " + cell.error : `${cell.status} sideways=${cell.layout?.pageScrollsSideways} off=${cell.layout?.offRightCount} clipped=${cell.layout?.clippedCount} axe=${cell.axe ? cell.axe.length : "-"} focus-no-ring=${cell.focus?.withoutRing.length}`}\n`
          );
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(OUT, "results.json"), JSON.stringify({ base: BASE, at: new Date().toISOString(), results }, null, 2));
  writeFileSync(path.join(OUT, "index.html"), sheet(results));
  console.log(`wrote ${results.length} cells to ${OUT}`);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function sheet(results) {
  const byPage = new Map();
  for (const r of results) {
    if (!byPage.has(r.page)) byPage.set(r.page, []);
    byPage.get(r.page).push(r);
  }
  const cols = THEMES.flatMap((t) => WIDTHS.map((w) => ({ t, w: w.name })));
  const flag = (r) => {
    if (r.error) return `<b class="bad">error</b> ${esc(r.error)}`;
    const out = [];
    if (r.status && r.status >= 400) out.push(`<b class="bad">HTTP ${r.status}</b>`);
    if (r.finalPath && r.finalPath !== r.page.split("?")[0]) out.push(`<span class="warn">→ ${esc(r.finalPath)}</span>`);
    if (r.layout?.pageScrollsSideways) out.push(`<b class="bad">scrolls sideways (${r.layout.scrollWidth}px)</b>`);
    if (r.layout?.offRightCount) out.push(`<span class="warn">${r.layout.offRightCount} off the edge</span>`);
    if (r.layout?.clippedCount) out.push(`<span class="warn">${r.layout.clippedCount} clipped</span>`);
    for (const a of r.axe ?? []) out.push(`<span class="bad">axe ${esc(a.id)} ×${a.nodes}</span>`);
    if (r.focus?.withoutRing?.length) out.push(`<span class="warn">${r.focus.withoutRing.length} focus stop(s) without a ring</span>`);
    return out.length ? out.join("<br>") : `<span class="ok">clean</span>`;
  };
  const rows = [...byPage.entries()]
    .map(
      ([p, cells]) => `<section><h2>${esc(p)}</h2><div class="grid">${cols
        .map(({ t, w }) => {
          const r = cells.find((c) => c.theme === t && c.width === w);
          if (!r) return "<figure></figure>";
          return `<figure class="w${w}"><figcaption>${t} · ${w}px</figcaption>${r.shot ? `<a href="${r.shot}" target="_blank"><img loading="lazy" src="${r.shot}" alt="${esc(p)} ${t} ${w}"></a>` : ""}<div class="flags">${flag(r)}</div></figure>`;
        })
        .join("")}</div></section>`
    )
    .join("\n");
  const total = results.length;
  const sideways = results.filter((r) => r.layout?.pageScrollsSideways).length;
  const axeCells = results.filter((r) => (r.axe ?? []).length).length;
  const errors = results.filter((r) => r.error || (r.status && r.status >= 400)).length;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Visual matrix</title>
<style>
:root{--bg:#f6f6f4;--ink:#161616;--muted:#666;--line:#ddd;--card:#fff;--bad:#b42318;--warn:#8a5a00;--ok:#1b7a3a}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121212;--ink:#eee;--muted:#aaa;--line:#333;--card:#1c1c1c;--bad:#ff8a80;--warn:#ffcc66;--ok:#7bdc9b}}
body{margin:0;padding:16px;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,sans-serif}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:24px 0 8px;font-family:ui-monospace,monospace}
.sum{color:var(--muted);margin-bottom:12px}
.grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px}
@media (max-width:900px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px;min-width:0}
figcaption{font-size:12px;color:var(--muted);margin-bottom:4px}
img{width:100%;max-height:420px;object-fit:cover;object-position:top;border-radius:4px;display:block}
.flags{font-size:12px;margin-top:6px;word-break:break-word}.bad{color:var(--bad)}.warn{color:var(--warn)}.ok{color:var(--ok)}
</style></head><body><h1>Visual matrix</h1>
<div class="sum">${total} cells · ${errors} errors · ${sideways} scroll sideways · ${axeCells} with serious/critical axe findings · base ${esc(BASE)} · ${new Date().toISOString()}</div>
${rows}</body></html>`;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
