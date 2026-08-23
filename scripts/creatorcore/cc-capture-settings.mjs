/**
 * The remaining Settings tabs, and the row-status dropdown the first pass
 * mis-targeted (it caught the Tags filter at the top of the page instead of a
 * control inside a campaign card, so this one constrains y to the card band).
 *
 * Settings lives at /settings?tab=<Name> -- a page of its own, which is why
 * /dashboard?tab=Settings silently fell back to Campaigns.
 *
 * READ ONLY: navigation only, plus one geometry-selected dropdown open that is
 * dismissed with Escape. Nothing is created, edited or deleted.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const EMAIL = process.env.CC_EMAIL, PASSWORD = process.env.CC_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error("CC_EMAIL/CC_PASSWORD missing"); process.exit(1); }

const OUT = path.join(import.meta.dirname, "out", "ui-gaps");
mkdirSync(OUT, { recursive: true });
const BASE = "https://app.creatorcore.co";
const FORBIDDEN = /\b(delete|remove|archive|pay|payout|deposit|withdraw|send|invite|revoke|disconnect|decline|accept|approve|reject|mark as complete|refresh data|save|confirm|submit|publish)\b/i;
const TABS = ["General", "Account", "Notifications", "Branding", "Team", "Stories", "Integrations"];

const CAPTURE = () => {
  const vis = (el) => { const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.opacity !== "0"; };
  const clean = (t) => (t || "").trim().replace(/\s+/g, " ");
  const labelFor = (el) => {
    const own = el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.getAttribute("title") || el.value || el.innerText;
    if (clean(own)) return clean(own).slice(0, 120);
    let n = el.parentElement;
    for (let h = 0; n && h < 3; h += 1, n = n.parentElement) { const t = clean(n.innerText); if (t) return t.slice(0, 120); }
    return "";
  };
  const S = "button, a, input, select, textarea, [role=button], [role=tab], [role=checkbox], [role=switch], [role=menuitem], [contenteditable=true]";
  const controls = [...document.querySelectorAll(S)].filter(vis).map((el) => {
    const r = el.getBoundingClientRect();
    return { tag: el.tagName.toLowerCase(), role: el.getAttribute("role") || null, label: labelFor(el),
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } };
  });
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); const text = []; let n;
  while ((n = w.nextNode())) {
    const t = clean(n.nodeValue); if (!t || t.length > 200) continue;
    const el = n.parentElement; if (!el || !vis(el)) continue;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    text.push({ t, x: Math.round(r.x), y: Math.round(r.y), size: Math.round(parseFloat(s.fontSize)), weight: s.fontWeight });
  }
  return { controls, text, title: document.title, url: location.href };
};

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
try {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 60_000 });
  await page.waitForTimeout(6000);
  console.log("logged in\n");

  for (const tab of TABS) {
    await page.goto(`${BASE}/settings?tab=${tab}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const s = await page.evaluate(CAPTURE);
    writeFileSync(path.join(OUT, `settings-${tab.toLowerCase()}.json`), JSON.stringify(s, null, 2));
    await page.screenshot({ path: path.join(OUT, `settings-${tab.toLowerCase()}.png`), fullPage: true });
    const heads = s.text.filter((t) => Number(t.weight) >= 600 && t.size >= 15).map((t) => t.t);
    console.log(`${tab.padEnd(14)} url=${s.url.replace(BASE, "")}  ${s.controls.length} controls`);
    console.log(`  sections: ${[...new Set(heads)].slice(0, 14).join(" | ")}`);
  }

  // The per-row status dropdown: small control inside a campaign card, so y is
  // constrained past the filter bar.
  await page.goto(`${BASE}/dashboard?tab=Campaigns`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const before = await page.evaluate(CAPTURE);
  const t = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const b = [...document.querySelectorAll("button")].filter(vis).map((el) => {
      const r = el.getBoundingClientRect();
      return { el, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    }).filter((c) => c.y > 250 && c.w <= 20 && c.h <= 20 && c.w >= 10 && c.x > 1300 && c.x < 1470);
    if (!b.length) return null;
    const f = b.sort((p, q) => p.y - q.y)[0];
    f.el.setAttribute("data-cap", "1");
    return { x: f.x, y: f.y, w: f.w, h: f.h, near: (f.el.closest("div")?.innerText || "").trim().slice(0, 60) };
  });
  if (!t) { console.log("\nrow-status: no candidate"); }
  else if (FORBIDDEN.test(t.near)) { console.log(`\nrow-status: ABORTED (${t.near})`); }
  else {
    console.log(`\nrow-status: x=${t.x} y=${t.y} ${t.w}x${t.h} near=${JSON.stringify(t.near)}`);
    await page.click('[data-cap="1"]');
    await page.waitForTimeout(2500);
    const after = await page.evaluate(CAPTURE);
    const seen = new Set(before.text.map((x) => `${x.t}|${x.x}|${x.y}`));
    const fresh = after.text.filter((x) => !seen.has(`${x.t}|${x.x}|${x.y}`));
    console.log(`  revealed ${fresh.length} text runs:`);
    for (const f of fresh.slice(0, 30)) console.log(`    "${f.t}"`);
    writeFileSync(path.join(OUT, "row-status-menu.json"), JSON.stringify({ target: t, revealed: fresh }, null, 2));
    await page.screenshot({ path: path.join(OUT, "row-status-menu.png") });
    await page.keyboard.press("Escape");
  }
} finally { await browser.close(); }
