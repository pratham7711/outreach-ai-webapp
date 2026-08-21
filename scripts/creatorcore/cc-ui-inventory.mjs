/**
 * Drives CreatorCore and inventories every interactive control on every surface.
 *
 * This exists because a parity PRD needs the reference observed, not inferred,
 * and the credentials must never pass through a chat transcript or a tool call.
 * They are read from webapp/.env (gitignored) as CC_EMAIL / CC_PASSWORD:
 *
 *   node --env-file=.env scripts/creatorcore/cc-ui-inventory.mjs
 *
 * VIEW ONLY, and deliberately so. The only clicks it performs are navigation --
 * left-nav entries and campaign sub-tabs -- which change what is displayed and
 * nothing else. Every other control is catalogued from the DOM without being
 * touched, and any control whose label matches MUTATORS is additionally flagged
 * so a later pass can never be told to click it by accident. Nothing in the
 * reference org is created, edited, refreshed or deleted.
 *
 * Output, one file per surface, under scripts/creatorcore/out/ui/:
 *   <surface>.json  — the interactive inventory
 *   <surface>.png   — full-page screenshot
 * Plus index.json summarising every surface visited.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const EMAIL = process.env.CC_EMAIL;
const PASSWORD = process.env.CC_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error(
    "CC_EMAIL and CC_PASSWORD must be set in webapp/.env (gitignored).\n" +
      "Run with: node --env-file=.env scripts/creatorcore/cc-ui-inventory.mjs",
  );
  process.exit(1);
}

const OUT = path.join(import.meta.dirname, "out", "ui");
mkdirSync(OUT, { recursive: true });

const BASE = "https://app.creatorcore.co";

/** Anything that writes. Catalogued, never clicked, and flagged for any later pass. */
const MUTATORS =
  /\b(delete|remove|archive|pay|payout|add funds|deposit|withdraw|save|submit|send|invite|create|new |refresh|sync|approve|decline|reject|cancel|import|export|share|revoke|disconnect|upload|duplicate|merge)\b/i;

/** The left nav, as read from the live app on 2026-08-12. */
const SURFACES = [
  "/?tab=Campaigns",
  "/?tab=Activations",
  "/?tab=Calendar",
  "/?tab=Clients",
  "/?tab=FanPages",
  "/?tab=Trackers",
  "/?tab=Discovery",
  "/?tab=Creators",
  "/?tab=Lists",
  "/?tab=Payouts",
  "/?tab=Requests",
  "/?tab=Recipients",
  "/?tab=Connections",
  "/?tab=Settings",
];

const CAMPAIGN_SUBTABS = [
  "Campaign",
  "Creators",
  "Drafts",
  "Posts",
  "Analytics",
  "Financials",
  "Documents",
  "Settings",
];

/**
 * Everything a user could act on, with enough context to describe it in a PRD.
 * Runs in page context.
 */
const INVENTORY = () => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none";
  };
  const label = (el) =>
    (
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.innerText ||
      el.value ||
      ""
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 120);

  const SELECTOR =
    'button, a, input, select, textarea, [role=button], [role=tab], [role=checkbox], [role=switch], [role=menuitem], [contenteditable=true]';

  const controls = [...document.querySelectorAll(SELECTOR)].filter(visible).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute("role") || null,
      type: el.getAttribute("type") || null,
      label: label(el),
      href: el.getAttribute("href") || null,
      disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
      // Rounded so a re-run produces a comparable file rather than pixel churn.
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  });

  // Tables are the bulk of this product; their headers are the data contract.
  const tables = [...document.querySelectorAll("table")].map((t) => ({
    headers: [...t.querySelectorAll("th")].map((h) => h.innerText.trim().replace(/\s+/g, " ")),
    rows: t.querySelectorAll("tbody tr").length,
  }));

  const headings = [...document.querySelectorAll("h1, h2, h3")]
    .filter(visible)
    .map((h) => h.innerText.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  return { controls, tables, headings, title: document.title, url: location.href };
};

function slug(s) {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "root";
}

async function capture(page, name) {
  // Bubble hydrates late and lazily; settle before reading the DOM.
  await page.waitForTimeout(4500);
  const data = await page.evaluate(INVENTORY);
  data.controls = data.controls.map((c) => ({ ...c, mutates: MUTATORS.test(c.label) }));
  data.surface = name;
  data.capturedAt = new Date().toISOString();
  writeFileSync(path.join(OUT, `${slug(name)}.json`), JSON.stringify(data, null, 2));
  await page.screenshot({ path: path.join(OUT, `${slug(name)}.png`), fullPage: true });
  const acting = data.controls.filter((c) => !c.mutates).length;
  console.log(
    `${name.padEnd(28)} ${String(data.controls.length).padStart(3)} controls ` +
      `(${acting} read, ${data.controls.length - acting} write) · ${data.tables.length} tables`,
  );
  return data;
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const index = [];

try {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 60_000 });
  console.log("logged in\n");

  for (const surface of SURFACES) {
    try {
      await page.goto(`${BASE}/${surface}`, { waitUntil: "domcontentloaded" });
      index.push(await capture(page, surface.replace("/?tab=", "")));
    } catch (err) {
      console.error(`${surface}: ${err.message}`);
    }
  }

  // One campaign, every sub-tab -- the core loop, and the deepest surface here.
  await page.goto(`${BASE}/?tab=Campaigns`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(4500);
  const firstCampaign = await page.evaluate(() => {
    const a = [...document.querySelectorAll("a[href*='campaign=']")][0];
    return a ? new URL(a.href).searchParams.get("campaign") : null;
  });

  if (!firstCampaign) {
    console.error("no campaign link found; campaign sub-tabs skipped");
  } else {
    for (const sub of CAMPAIGN_SUBTABS) {
      try {
        await page.goto(`${BASE}/?tab=Campaign&campaign=${firstCampaign}&sub=${sub}`, {
          waitUntil: "domcontentloaded",
        });
        index.push(await capture(page, `campaign-${sub}`));
      } catch (err) {
        console.error(`campaign/${sub}: ${err.message}`);
      }
    }
  }

  writeFileSync(
    path.join(OUT, "index.json"),
    JSON.stringify(
      index.map((d) => ({
        surface: d.surface,
        url: d.url,
        headings: d.headings,
        controls: d.controls.length,
        writeControls: d.controls.filter((c) => c.mutates).length,
        tables: d.tables,
      })),
      null,
      2,
    ),
  );
  console.log(`\n${index.length} surfaces → ${OUT}`);
} finally {
  await browser.close();
}
