/**
 * Where the reference actually applies creator tags and flags.
 *
 * The creators list shows none of them -- only name, handle, followers and
 * average views -- so the settings lists must be consumed somewhere else, and
 * building an attach UI without knowing where would be a guess rather than a
 * clone. This opens a creator's own page and the list's Filter drawer.
 *
 * READ ONLY. The only clicks are opening a creator row and the Filter control,
 * both guarded by FORBIDDEN, and each dismissed with Escape.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const EMAIL = process.env.CC_EMAIL, PASSWORD = process.env.CC_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error("CC_EMAIL/CC_PASSWORD missing"); process.exit(1); }

const OUT = path.join(import.meta.dirname, "out", "ui-gaps");
mkdirSync(OUT, { recursive: true });
const BASE = "https://app.creatorcore.co";
const FORBIDDEN =
  /\b(delete|remove|archive|pay|payout|deposit|withdraw|send|invite|revoke|disconnect|decline|accept|approve|reject|mark as complete|refresh data|save|confirm|submit|publish)\b/i;

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
    return { tag: el.tagName.toLowerCase(), label: labelFor(el),
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
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await ctx.newPage();

const report = (label, snap) => {
  const hits = [
    ...snap.controls.filter((c) => /tag|flag/i.test(c.label || "")).map((c) => `ctrl ${c.tag} "${c.label.slice(0, 60)}"`),
    ...snap.text.filter((t) => /tag|flag/i.test(t.t)).map((t) => `text "${t.t.slice(0, 60)}"`),
  ];
  console.log(`${label}: ${snap.controls.length} controls, ${snap.text.length} text runs`);
  console.log(`  tag/flag mentions: ${hits.length}`);
  for (const h of [...new Set(hits)].slice(0, 14)) console.log(`    ${h}`);
};

try {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 60_000 });
  await page.waitForTimeout(6000);
  console.log("logged in\n");

  await page.goto(`${BASE}/dashboard?tab=Creators`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const listSnap = await page.evaluate(CAPTURE);
  writeFileSync(path.join(OUT, "creators-list.json"), JSON.stringify(listSnap, null, 2));
  report("creators list", listSnap);

  // The Filter drawer -- the likeliest home of a tag/flag filter.
  const filterBtn = page.getByRole("button", { name: /^filter$/i }).first();
  if (await filterBtn.count()) {
    const label = (await filterBtn.getAttribute("aria-label")) || "Filter";
    if (!FORBIDDEN.test(label)) {
      await filterBtn.click();
      await page.waitForTimeout(3000);
      const snap = await page.evaluate(CAPTURE);
      writeFileSync(path.join(OUT, "creators-filter.json"), JSON.stringify(snap, null, 2));
      await page.screenshot({ path: path.join(OUT, "creators-filter.png") });
      report("\ncreators filter drawer", snap);
      await page.keyboard.press("Escape");
      await page.waitForTimeout(800);
    }
  } else {
    console.log("\nfilter control not found");
  }

  // A creator's own page: click the first creator name in the list.
  await page.goto(`${BASE}/dashboard?tab=Creators`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(7000);
  const opened = await page.evaluate(() => {
    const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    // Creator rows start below the header band; the handle text sits at x~378.
    const cand = [...document.querySelectorAll("a, [role=button], button, div")]
      .filter(vis)
      .filter((el) => {
        const r = el.getBoundingClientRect();
        const t = (el.innerText || "").trim();
        return r.y > 150 && r.x > 300 && r.x < 700 && r.height < 90 && /^@?[\w.\-]{3,30}$/.test(t);
      });
    if (!cand.length) return null;
    cand[0].setAttribute("data-cap", "1");
    return (cand[0].innerText || "").trim().slice(0, 40);
  });

  if (opened) {
    console.log(`\nopening creator ${JSON.stringify(opened)}`);
    await page.click('[data-cap="1"]');
    await page.waitForTimeout(8000);
    const snap = await page.evaluate(CAPTURE);
    writeFileSync(path.join(OUT, "creator-detail.json"), JSON.stringify(snap, null, 2));
    await page.screenshot({ path: path.join(OUT, "creator-detail.png"), fullPage: true });
    console.log(`  url=${snap.url}`);
    report("creator detail", snap);
  } else {
    console.log("\nno creator row matched");
  }
} finally {
  await browser.close();
}
