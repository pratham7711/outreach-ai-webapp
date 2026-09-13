/**
 * The side-by-side review step.
 *
 * The measured diff answers "which property differs". It cannot answer "does
 * this read as the same product", and that is the question the goal is written
 * in. So this drives our app live with Playwright, shoots each surface, and
 * composites it against the reference shot already in docs/parity/reference --
 * one image per surface, their screen on the left, ours on the right, at the
 * same scale, with a ruler strip so a shifted element is measurable off the
 * picture itself.
 *
 * The reference side is never re-fetched: those captures are the durable
 * archive, which is the whole reason they were committed.
 *
 *   node scripts/creatorcore/parity/review.mjs [--viewport desktop-1600] [--only campaigns,clients]
 */
import { chromium } from "playwright";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { encode } from "next-auth/jwt";
import { PAIRS } from "./pairs.mjs";

const args = process.argv.slice(2);
const argOf = (n, d) => (args.indexOf(n) >= 0 ? args[args.indexOf(n) + 1] : d);
const VIEWPORT = argOf("--viewport", "desktop-1600");
const ONLY = argOf("--only", null)?.split(",").map((s) => s.trim());
const BASE = argOf("--base", "http://localhost:3009");

const VP_SIZE = {
  "desktop-1600": { width: 1600, height: 1000 },
  "desktop-1440": { width: 1440, height: 900 },
  "tablet-768": { width: 768, height: 1024 },
  "mobile-390": { width: 390, height: 844 },
}[VIEWPORT];
if (!VP_SIZE) throw new Error(`unknown viewport ${VIEWPORT}`);

const ROOT = process.cwd();
const REF_DIR = path.join(ROOT, "docs/parity/reference", VIEWPORT);
const OUT_DIR = path.join(ROOT, "docs/parity/review", VIEWPORT);
fs.mkdirSync(OUT_DIR, { recursive: true });

/* Our route for one of THEIR surface ids. The pairs table maps ids; this maps
   our id to the path that renders it, mirroring capture-ours.mjs so the two
   cannot drift into shooting different screens under the same name. */
function ourPath(ourId, campaignId) {
  if (ourId.startsWith("nav-")) return "/" + ourId.slice(4);
  if (ourId.startsWith("settings-")) return "/settings/" + ourId.slice(9);
  if (ourId.startsWith("campaign-")) {
    if (!campaignId) return null;
    return `/campaigns/${campaignId}?section=${ourId.slice(9)}`;
  }
  return null;
}

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"(.*)"$/, "$1")];
  })
);
const COOKIE = "authjs.session-token";
const token = await encode({
  token: { sub: "cmnbxspfv00016vfdz6yuds55", id: "cmnbxspfv00016vfdz6yuds55",
    email: "admin@demo.com", name: "Admin",
    orgId: "cmnbxsoos00006vfd7jhdvusb", role: "OWNER" },
  secret: env.NEXTAUTH_SECRET, salt: COOKIE,
});

const LABEL_H = 34;
const GUTTER = 16;

/** A caption bar plus a 100px ruler, rendered once and reused. */
async function labelStrip(text, width, tone) {
  const svg = `<svg width="${width}" height="${LABEL_H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="${width}" height="${LABEL_H}" fill="${tone}"/>
    <text x="10" y="22" font-family="ui-monospace,Menlo,monospace" font-size="14" fill="#fff">${text}</text>
    ${Array.from({ length: Math.floor(width / 100) }, (_, i) =>
      `<rect x="${(i + 1) * 100}" y="${LABEL_H - 8}" width="1" height="8" fill="#ffffff88"/>
       <text x="${(i + 1) * 100 + 3}" y="${LABEL_H - 10}" font-family="ui-monospace,monospace" font-size="9" fill="#ffffffaa">${(i + 1) * 100}</text>`
    ).join("")}
  </svg>`;
  return Buffer.from(svg);
}

async function compose(refPng, oursPng, outPath, surface, ourId) {
  const [rm, om] = [await sharp(refPng).metadata(), await sharp(oursPng).metadata()];
  /* The reference shots are 2x device-scale; ours are 1x. Normalising to the
     viewport's CSS width is what makes a side-by-side comparable at all --
     otherwise their screen is simply twice the size and everything "differs". */
  const W = VP_SIZE.width;
  const refR = await sharp(refPng).resize({ width: W }).toBuffer();
  const ourR = await sharp(oursPng).resize({ width: W }).toBuffer();
  const rh = (await sharp(refR).metadata()).height;
  const oh = (await sharp(ourR).metadata()).height;
  const H = Math.max(rh, oh);
  const canvasW = W * 2 + GUTTER;
  const canvasH = H + LABEL_H;

  return sharp({ create: { width: canvasW, height: canvasH, channels: 4, background: "#1b1f2a" } })
    .composite([
      { input: await labelStrip(`CreatorCore  ${surface}  ${VIEWPORT}  (${rm.width}x${rm.height})`, W, "#1F3CEF"), top: 0, left: 0 },
      { input: refR, top: LABEL_H, left: 0 },
      { input: await labelStrip(`OURS  ${ourId}  creatorcore theme  (${om.width}x${om.height})`, W, "#8a1f5c"), top: 0, left: W + GUTTER },
      { input: ourR, top: LABEL_H, left: W + GUTTER },
    ])
    .png()
    .toFile(outPath);
}

const browser = await chromium.launch({ channel: "chrome" });
const ctx = await browser.newContext({ viewport: VP_SIZE, deviceScaleFactor: 1 });
await ctx.addCookies([{ name: COOKIE, value: token, domain: "localhost", path: "/", httpOnly: true, secure: false, sameSite: "Lax" }]);
await ctx.addInitScript(`try{
  localStorage.setItem("theme","creatorcore");
  localStorage.setItem("cc-sidebar-collapsed","false");
}catch(e){}`);

/* The campaign fixture, found the way capture-ours finds it, so the review and
   the measurement land on the same campaign. */
let campaignId = null;
{
  const p = await ctx.newPage();
  await p.goto(BASE + "/campaigns", { waitUntil: "domcontentloaded" });
  await p.waitForTimeout(1200);
  campaignId = await p.evaluate(() => {
    const a = [...document.querySelectorAll('a[href^="/campaigns/"]')]
      .map((x) => x.getAttribute("href").split("/")[2]).filter((x) => x && x !== "self-serve");
    return a[0] ?? null;
  });
  await p.close();
}

const rows = [];
for (const [refId, ourId] of Object.entries(PAIRS)) {
  if (ONLY && !ONLY.includes(refId)) continue;
  const refPng = path.join(REF_DIR, `${refId}.viewport.png`);
  if (!fs.existsSync(refPng)) { rows.push({ refId, ourId, status: "NO_REF_SHOT" }); continue; }
  const route = ourPath(ourId, campaignId);
  if (!route) { rows.push({ refId, ourId, status: "NO_ROUTE" }); continue; }

  const page = await ctx.newPage();
  const tmp = path.join(OUT_DIR, `.${ourId}.tmp.png`);
  try {
    await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("main, .cc-sidebar-rail", { timeout: 30000 }).catch(() => {});
    /* Skeletons and lazy images move the page under the shutter, so settle on
       the DOM going quiet rather than on a fixed sleep. */
    await page.waitForFunction(() => {
      const n = document.querySelectorAll('[class*="skeleton"],[data-loading="true"]').length;
      return n === 0;
    }, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(900);
    await page.screenshot({ path: tmp });
    const out = path.join(OUT_DIR, `${refId}.sbs.png`);
    await compose(refPng, tmp, out, refId, ourId);
    fs.unlinkSync(tmp);
    rows.push({ refId, ourId, status: "OK", out: path.relative(ROOT, out) });
    console.log(`  ok  ${refId.padEnd(28)} vs ${ourId}`);
  } catch (e) {
    rows.push({ refId, ourId, status: "ERROR", error: String(e).split("\n")[0] });
    console.log(`  ERR ${refId.padEnd(28)} ${String(e).split("\n")[0]}`);
  }
  await page.close();
}
await browser.close();

const index = `<!doctype html><meta charset=utf-8><title>parity review ${VIEWPORT}</title>
<style>body{margin:0;background:#11141c;color:#e7e9ee;font:14px ui-monospace,Menlo,monospace}
h1{font-size:16px;padding:14px 18px;margin:0;position:sticky;top:0;background:#11141c;border-bottom:1px solid #2a2f3d;z-index:2}
section{padding:18px}img{width:100%;display:block;border:1px solid #2a2f3d}
h2{font-size:13px;color:#9aa3b8;margin:0 0 8px}</style>
<h1>CreatorCore parity review &middot; ${VIEWPORT} &middot; ${rows.filter(r=>r.status==="OK").length} surfaces</h1>
${rows.filter((r) => r.status === "OK").map((r) => `<section><h2>${r.refId} &rarr; ${r.ourId}</h2><img loading=lazy src="${r.refId}.sbs.png"></section>`).join("\n")}`;
fs.writeFileSync(path.join(OUT_DIR, "index.html"), index);
fs.writeFileSync(path.join(OUT_DIR, "index.json"), JSON.stringify({ viewport: VIEWPORT, campaignId, rows }, null, 2));
console.log(`\n${rows.filter((r) => r.status === "OK").length} composed -> docs/parity/review/${VIEWPORT}/index.html`);
