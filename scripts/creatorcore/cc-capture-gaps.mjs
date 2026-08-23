/**
 * Captures the CreatorCore surfaces the earlier passes could not reach.
 *
 *   node --env-file=.env scripts/creatorcore/cc-capture-gaps.mjs
 *
 * cc-ui-inventory only ever clicked navigation, so three things stayed unseen:
 * the per-row kebab on the campaigns list, the per-row status dropdown, and
 * Settings — whose URL token silently falls back to Campaigns, so it has to be
 * reached by clicking the sidebar entry. It also captured the campaign sub-tabs
 * against a campaign with almost nothing in it; this drives the busiest campaign
 * in the account instead, and the reference campaign beside it.
 *
 * READ ONLY, and structurally so:
 *
 *   - Click targets are chosen by geometry, not by label. Bubble resolves an
 *     icon-only button's label from whatever text sits near it, which is exactly
 *     how the kebab went unnoticed ("In-Progress Share") — so a label is too
 *     unreliable a thing to authorise a click with.
 *   - FORBIDDEN is checked against the resolved label of every target before it
 *     is clicked, and against every label a newly opened menu reveals. It is a
 *     stop, not a filter: a hit aborts that target.
 *   - Nothing inside an opened menu is ever clicked. Each one is dismissed with
 *     Escape and the surface is reloaded before the next target, so no state
 *     carries over.
 *
 * Nothing in the reference account is created, edited, refreshed or deleted.
 *
 * Output under scripts/creatorcore/out/ui-gaps/ (gitignored): a JSON of the
 * controls each menu revealed, a screenshot, and gaps-index.json.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const EMAIL = process.env.CC_EMAIL;
const PASSWORD = process.env.CC_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("CC_EMAIL and CC_PASSWORD must be set in webapp/.env (gitignored).");
  process.exit(1);
}

const OUT = path.join(import.meta.dirname, "out", "ui-gaps");
mkdirSync(OUT, { recursive: true });

const BASE = "https://app.creatorcore.co";

/** Anything that commits, sends, pays or destroys. A hit aborts the target. */
const FORBIDDEN =
  /\b(delete|remove|archive|pay|payout|deposit|withdraw|send|invite|revoke|disconnect|decline|accept|approve|reject|mark as complete|refresh data|save|confirm|submit|publish)\b/i;

/** The busiest campaign in the account, and the one we clone against. */
const BUSY_CAMPAIGN = "1768835393734x988983349912272900"; // Playlists, 492 posts
const REF_CAMPAIGN = "1787168795505x629841318282526700"; // Wherever I go - Ellie Holcomb

const SUBTABS = ["Overview", "Creators", "Drafts", "Posts", "Analytics", "Financials", "Documents", "Settings"];

/* ── the in-page reader, shared with cc-ui-inventory's shape ──────────────── */
const CAPTURE = () => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.opacity !== "0";
  };
  const clean = (t) => (t || "").trim().replace(/\s+/g, " ");
  const labelFor = (el) => {
    const own =
      el.getAttribute("aria-label") || el.getAttribute("placeholder") ||
      el.getAttribute("title") || el.value || el.innerText;
    if (clean(own)) return clean(own).slice(0, 120);
    let node = el.parentElement;
    for (let hops = 0; node && hops < 3; hops += 1, node = node.parentElement) {
      const text = clean(node.innerText);
      if (text) return text.slice(0, 120);
    }
    return "";
  };
  const SELECTOR =
    "button, a, input, select, textarea, [role=button], [role=tab], [role=checkbox], [role=switch], [role=menuitem], [contenteditable=true]";
  const controls = [...document.querySelectorAll(SELECTOR)].filter(visible).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || null,
      label: labelFor(el),
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  });
  // Every visible text run, with weight and position -- Bubble grids are divs,
  // so this is the only way to reconstruct a column layout.
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const text = [];
  let n;
  while ((n = walker.nextNode())) {
    const t = clean(n.nodeValue);
    if (!t || t.length > 200) continue;
    const el = n.parentElement;
    if (!el || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    text.push({
      t,
      x: Math.round(r.x), y: Math.round(r.y),
      size: Math.round(parseFloat(s.fontSize)), weight: s.fontWeight,
      color: s.color,
    });
  }
  return { controls, text, title: document.title, url: location.href };
};

const key = (c) => `${c.tag}|${c.label}|${c.box.w}x${c.box.h}`;

async function snapshot(page) {
  return page.evaluate(CAPTURE);
}

/** What appeared that was not there before -- i.e. the menu contents. */
function revealed(before, after) {
  const seen = new Set(before.controls.map(key));
  const newControls = after.controls.filter((c) => !seen.has(key(c)));
  const seenText = new Set(before.text.map((t) => `${t.t}|${t.x}|${t.y}`));
  const newText = after.text.filter((t) => !seenText.has(`${t.t}|${t.x}|${t.y}`));
  return { newControls, newText };
}

const index = [];

async function record(name, data, page) {
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(data, null, 2));
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: false });
  index.push({ name, ...("newControls" in data ? { revealed: data.newControls.length } : {}) });
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();

try {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 60_000 });
  await page.waitForTimeout(6000);
  console.log("logged in\n");

  /* ── 1. the campaigns-list kebab and status dropdown ─────────────────────
     Chosen by geometry: on each campaign card the kebab is the right-most
     small square, and the status control is the small one just left of Share. */
  for (const [name, pick] of [
    ["kebab", "kebab"],
    ["row-status", "status"],
  ]) {
    await page.goto(`${BASE}/dashboard?tab=Campaigns`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(6000);
    const before = await snapshot(page);

    const target = await page.evaluate((which) => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
      };
      const btns = [...document.querySelectorAll("button")].filter(vis).map((el) => {
        const r = el.getBoundingClientRect();
        return { el, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
      });
      const small = btns.filter((b) => b.w <= 30 && b.h <= 30 && b.w >= 12);
      if (!small.length) return null;
      const maxX = Math.max(...small.map((b) => b.x));
      // kebab: right-most column. status: the small control ~140px left of it.
      const wanted =
        which === "kebab"
          ? small.filter((b) => b.x >= maxX - 6)
          : small.filter((b) => b.x < maxX - 60 && b.x > maxX - 220);
      if (!wanted.length) return null;
      const first = wanted.sort((a, b) => a.y - b.y)[0];
      first.el.setAttribute("data-capture-target", "1");
      return { x: first.x, y: first.y, w: first.w, h: first.h };
    }, pick);

    if (!target) {
      console.log(`${name}: no candidate found`);
      continue;
    }

    const label = await page.getAttribute('[data-capture-target="1"]', "aria-label");
    const nearby = await page
      .locator('[data-capture-target="1"]')
      .evaluate((el) => (el.closest("div")?.innerText || "").trim().slice(0, 80));
    console.log(`${name}: target at x=${target.x} y=${target.y} ${target.w}x${target.h}  nearby=${JSON.stringify(nearby)}`);

    if (FORBIDDEN.test(label || "") || FORBIDDEN.test(nearby)) {
      console.log(`${name}: ABORTED -- target text matches FORBIDDEN`);
      continue;
    }

    await page.click('[data-capture-target="1"]');
    await page.waitForTimeout(2500);
    const after = await snapshot(page);
    const rev = revealed(before, after);

    const risky = [...rev.newControls.map((c) => c.label), ...rev.newText.map((t) => t.t)]
      .filter((l) => FORBIDDEN.test(l || ""));
    console.log(`${name}: revealed ${rev.newControls.length} controls, ${rev.newText.length} text runs` +
      (risky.length ? `  (${risky.length} destructive-looking, NOT clicked)` : ""));
    for (const t of rev.newText.slice(0, 25)) console.log(`    "${t.t}"`);

    await record(name, { target, before: { controls: before.controls.length }, ...rev, risky }, page);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
  }

  /* ── 2. Settings — the URL token falls back, so click the sidebar entry ── */
  await page.goto(`${BASE}/dashboard?tab=Campaigns`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(6000);
  const settingsClicked = await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    const hit = btns.find((b) => (b.innerText || "").trim() === "Settings" ||
      (b.parentElement?.innerText || "").trim() === "Settings");
    if (!hit) return false;
    hit.setAttribute("data-capture-target", "1");
    return true;
  });
  if (settingsClicked) {
    await page.click('[data-capture-target="1"]');
    await page.waitForTimeout(7000);
    const s = await snapshot(page);
    console.log(`\nSettings: url=${s.url}`);
    console.log(`  title=${s.title}`);
    const tabs = s.controls.filter((c) => c.box.y < 300 && c.label && c.label.length < 40);
    console.log(`  ${s.controls.length} controls; candidate tabs:`);
    for (const t of [...new Set(tabs.map((c) => c.label))].slice(0, 20)) console.log(`    "${t}"`);
    await record("settings", s, page);
  } else {
    console.log("\nSettings: sidebar entry not found");
  }

  /* ── 3. campaign sub-tabs, against a campaign that actually has data ───── */
  for (const [tag, id] of [["busy", BUSY_CAMPAIGN], ["ref", REF_CAMPAIGN]]) {
    for (const sub of SUBTABS) {
      try {
        await page.goto(`${BASE}/dashboard?tab=Campaign&campaign=${id}&sub=${sub}`, {
          waitUntil: "domcontentloaded",
        });
        await page.waitForTimeout(5500);
        const s = await snapshot(page);
        const name = `campaign-${tag}-${sub.toLowerCase()}`;
        await record(name, s, page);
        console.log(`${name}: ${s.controls.length} controls, ${s.text.length} text runs`);
      } catch (err) {
        console.error(`campaign-${tag}-${sub}: ${err.message.split("\n")[0]}`);
      }
    }
  }

  /* ── 4. Activations, whose grouping is the biggest single-surface gap ──── */
  await page.goto(`${BASE}/dashboard?tab=Activations`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(8000);
  const act = await snapshot(page);
  await record("activations-full", act, page);
  const groups = act.text.filter((t) => /\(\d+\)\s*$/.test(t.t));
  console.log(`\nActivations: ${act.controls.length} controls; ${groups.length} group headers`);
  for (const g of groups) console.log(`    "${g.t}"`);

  writeFileSync(path.join(OUT, "gaps-index.json"), JSON.stringify(index, null, 2));
  console.log(`\n${index.length} surfaces written to ${OUT}`);
} finally {
  await browser.close();
}
