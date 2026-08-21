/**
 * Drives CreatorCore and inventories every surface for the parity PRD.
 *
 * Credentials come from webapp/.env (gitignored) so they never pass through a
 * chat transcript or a tool call:
 *
 *   node --env-file=.env scripts/creatorcore/cc-ui-inventory.mjs
 *
 * VIEW ONLY, deliberately. The only clicks are navigation -- left-nav entries
 * and campaign sub-tabs -- which change what is displayed and nothing else.
 * Every other control is read from the DOM untouched, and anything whose label
 * matches MUTATORS is flagged in the output so no later pass can be handed one
 * to click by mistake. Nothing in the reference org is created, edited,
 * refreshed or deleted.
 *
 * Bubble makes two things awkward, and both are handled here:
 *   - Controls are icon-only <button>s whose visible label is a *sibling* text
 *     node, so a label is resolved by walking outward until text appears.
 *   - Grids are nested divs, never <table>, so column headers cannot be read
 *     semantically. Instead every visible text run is captured with its
 *     position and weight, which reconstructs the layout well enough to
 *     describe a screen and diff it against ours.
 *
 * Output per surface, under scripts/creatorcore/out/ui/ (gitignored):
 *   <surface>.json  — controls + text map
 *   <surface>.png   — full-page screenshot
 * Plus index.json summarising every surface.
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

const OUT = path.join(import.meta.dirname, "out", "ui");
mkdirSync(OUT, { recursive: true });

const BASE = "https://app.creatorcore.co";

const MUTATORS =
  /\b(delete|remove|archive|pay|payout|add funds|deposit|withdraw|save|submit|send|invite|create|new |refresh|sync|approve|decline|reject|cancel|import|export|revoke|disconnect|upload|duplicate|merge)\b/i;

/**
 * The left nav. Tokens confirmed from the URLs the app itself produced when the
 * sidebar was clicked -- navigating straight to them is more reliable than
 * clicking text, which mis-targeted neighbouring entries.
 */
const NAV = [
  ["Campaigns", "tab=Campaigns"],
  ["Activations", "tab=Activations"],
  ["Calendar", "tab=Calendar"],
  ["Clients", "tab=Clients"],
  ["Fan Pages", "tab=FanPages"],
  ["Trackers", "tab=Trackers&sub=sound&period=7"],
  ["Trackers-creators", "tab=Trackers&sub=creator&period=7"],
  ["Discovery", "tab=Discovery&platform=TikTok"],
  ["Creators", "tab=Creators"],
  ["Lists", "tab=Lists"],
  ["Payouts", "tab=Payouts"],
  ["Requests", "tab=Requests"],
  ["Recipients", "tab=Recipients"],
  ["Connections", "tab=Connections"],
  ["Settings", "tab=Settings"],
];

/** A real campaign from the extract, so the detail tabs never depend on a click. */
const CAMPAIGN_ID = "1749303629139x526598772507279360";

const CAMPAIGN_SUBTABS = [
  "Overview",
  "Creators",
  "Drafts",
  "Posts",
  "Analytics",
  "Financials",
  "Documents",
  "Settings",
];

const CAPTURE = () => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return (
      r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.opacity !== "0"
    );
  };

  const clean = (t) => (t || "").trim().replace(/\s+/g, " ");

  /** Bubble labels sit beside the control, so walk outward until text appears. */
  const labelFor = (el) => {
    const own =
      el.getAttribute("aria-label") ||
      el.getAttribute("placeholder") ||
      el.getAttribute("title") ||
      el.value ||
      el.innerText;
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
      type: el.getAttribute("type") || null,
      label: labelFor(el),
      href: el.getAttribute("href") || null,
      disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
      box: {
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
      },
    };
  });

  /* Every visible text run with its position and weight. This is the layout:
     headers, stat labels, values, tab names -- whatever the screen says. */
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const text = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const value = clean(n.nodeValue);
    if (!value) continue;
    const el = n.parentElement;
    if (!el || !visible(el)) continue;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    text.push({
      text: value.slice(0, 160),
      x: Math.round(r.x),
      y: Math.round(r.y),
      size: Math.round(parseFloat(s.fontSize)),
      weight: s.fontWeight,
      color: s.color,
    });
  }

  return { controls, text, title: document.title, url: location.href };
};

function slug(s) {
  return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "root";
}

async function capture(page, name) {
  await page.waitForTimeout(5000); // Bubble hydrates late and lazily.
  const data = await page.evaluate(CAPTURE);
  data.controls = data.controls.map((c) => ({ ...c, mutates: MUTATORS.test(c.label) }));
  data.surface = name;
  writeFileSync(path.join(OUT, `${slug(name)}.json`), JSON.stringify(data, null, 2));
  await page.screenshot({ path: path.join(OUT, `${slug(name)}.png`), fullPage: true });
  console.log(
    `${name.padEnd(22)} ${String(data.controls.length).padStart(3)} controls · ` +
      `${String(data.text.length).padStart(4)} text runs · ${data.url.replace(BASE, "")}`,
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
  await page.waitForTimeout(6000);
  console.log("logged in\n");

  for (const [name, query] of NAV) {
    try {
      await page.goto(`${BASE}/dashboard?${query}`, { waitUntil: "domcontentloaded" });
      index.push(await capture(page, name));
    } catch (err) {
      console.error(`${name}: ${err.message.split("\n")[0]}`);
    }
  }

  // One campaign, every sub-tab: the core loop and the deepest surface here.
  for (const sub of CAMPAIGN_SUBTABS) {
    try {
      await page.goto(
        `${BASE}/dashboard?tab=Campaign&campaign=${CAMPAIGN_ID}&sub=${sub}`,
        { waitUntil: "domcontentloaded" }
      );
      index.push(await capture(page, `campaign-${sub}`));
    } catch (err) {
      console.error(`campaign/${sub}: ${err.message.split("\n")[0]}`);
    }
  }

  writeFileSync(
    path.join(OUT, "index.json"),
    JSON.stringify(
      index.map((d) => ({
        surface: d.surface,
        url: d.url,
        title: d.title,
        controls: d.controls.length,
        writeControls: d.controls.filter((c) => c.mutates).length,
      })),
      null,
      2,
    ),
  );
  console.log(`\n${index.length} surfaces → ${OUT}`);
} finally {
  await browser.close();
}
