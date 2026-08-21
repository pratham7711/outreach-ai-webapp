/**
 * Opens every modal, dropdown and create flow in CreatorCore and inventories
 * what appears, then closes it without submitting.
 *
 *   node --env-file=.env scripts/creatorcore/cc-modal-inventory.mjs
 *
 * The surface inventory (cc-ui-inventory.mjs) could only see what renders
 * without interaction, so it covers no modal, no dropdown and no create form.
 * This fills that gap.
 *
 * SAFETY. Opening a create form writes nothing -- only its submit button does,
 * and this script never presses one. Concretely:
 *   - Every click target is named explicitly in TARGETS. Nothing is discovered
 *     and clicked automatically.
 *   - FORBIDDEN is checked against every target before clicking and against
 *     every control inside an opened modal before any step advance. A match
 *     aborts that target rather than guessing.
 *   - Each modal is dismissed with Escape, then the surface is reloaded, so no
 *     state carries from one target to the next.
 *   - Multi-step forms advance only via an explicit `next` label, and stop at
 *     the step budget. The final submit is never reached.
 * Nothing in the reference org is created, edited, refreshed or deleted.
 *
 * Output under scripts/creatorcore/out/modals/ (gitignored):
 *   <name>.json  — controls + text after opening, and what is new vs the surface
 *   <name>.png   — screenshot of the open modal
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";

const EMAIL = process.env.CC_EMAIL;
const PASSWORD = process.env.CC_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("CC_EMAIL and CC_PASSWORD must be set in webapp/.env (gitignored).");
  process.exit(1);
}

const OUT = path.join(import.meta.dirname, "out", "modals");
const SURFACES = path.join(import.meta.dirname, "out", "ui");
mkdirSync(OUT, { recursive: true });

const BASE = "https://app.creatorcore.co";
const CAMPAIGN_ID = "1749303629139x526598772507279360";

/**
 * Anything that commits, sends, pays or destroys. Checked before clicking a
 * target and before advancing a step. This is a stop, not a filter.
 */
const FORBIDDEN =
  /\b(delete|remove|archive|pay|payout|deposit|withdraw|send|invite|revoke|disconnect|decline|accept|approve|reject|mark as complete|refresh data|save|confirm|submit|publish|create campaign|add campaign)\b/i;

/**
 * name · surface query · the control to click · optional step advance.
 * Only these are ever clicked.
 */
const TARGETS = [
  ["new-campaign", "tab=Campaigns", "New Campaign", { next: "Next", steps: 6 }],
  ["campaigns-folders", "tab=Campaigns", "Folders"],
  ["campaigns-filter-status", "tab=Campaigns", "Campaign Status"],
  ["campaigns-filter-team", "tab=Campaigns", "Team Member"],
  ["campaigns-filter-tags", "tab=Campaigns", "Tags"],
  ["campaigns-filter-client", "tab=Campaigns", "Client"],
  ["campaigns-filter-date", "tab=Campaigns", "Creation Date"],
  ["new-creator", "tab=Creators", "New Creator", { next: "Next", steps: 4 }],
  ["creators-filter", "tab=Creators", "Filter"],
  ["creators-sort", "tab=Creators", "Date Added"],
  ["new-list", "tab=Lists", "New List"],
  ["new-client", "tab=Clients", "New Client"],
  ["new-tracker", "tab=Trackers&sub=sound&period=7", "New Tracker"],
  ["trackers-period", "tab=Trackers&sub=sound&period=7", "7 Days"],
  ["activations-filter", "tab=Activations", "Filter"],
  ["activations-status", "tab=Activations", "Status"],
  ["discovery-filters", "tab=Discovery&platform=TikTok", "Filters"],
  [
    "add-posts",
    `tab=Campaign&campaign=${CAMPAIGN_ID}&sub=Posts`,
    "Add Posts",
    { next: "Next", steps: 3 },
  ],
  ["posts-sort", `tab=Campaign&campaign=${CAMPAIGN_ID}&sub=Posts`, "Views/Engagement"],
  ["share-campaign", `tab=Campaign&campaign=${CAMPAIGN_ID}&sub=Posts`, "Share Campaign"],
  ["campaign-add-tag", `tab=Campaign&campaign=${CAMPAIGN_ID}&sub=Overview`, "Add Tag"],
];

const CAPTURE = () => {
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.opacity !== "0";
  };
  const clean = (t) => (t || "").trim().replace(/\s+/g, " ");
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
      if (clean(node.innerText)) return clean(node.innerText).slice(0, 120);
    }
    return "";
  };

  const SELECTOR =
    "button, a, input, select, textarea, [role=button], [role=tab], [role=checkbox], [role=switch], [role=menuitem], [contenteditable=true]";
  const controls = [...document.querySelectorAll(SELECTOR)].filter(visible).map((el) => {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || null,
      label: labelFor(el),
      required: el.required === true,
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w || r.width), h: Math.round(r.height) },
    };
  });

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
    });
  }
  return { controls, text, url: location.href };
};

/** Labels present now that the plain surface did not have: the modal itself. */
function newVsSurface(after, surfaceFile) {
  const file = path.join(SURFACES, surfaceFile);
  if (!existsSync(file)) return null;
  const before = JSON.parse(readFileSync(file, "utf8"));
  const seen = new Set((before.text || []).map((t) => t.text));
  return {
    newText: after.text.filter((t) => !seen.has(t.text)).map((t) => t.text),
    newControls: after.controls
      .filter((c) => !(before.controls || []).some((b) => b.label === c.label))
      .map((c) => `${c.tag}${c.type ? `[${c.type}]` : ""}: ${c.label || "(icon)"}`),
  };
}

const SURFACE_FILE = {
  "tab=Campaigns": "campaigns.json",
  "tab=Creators": "creators.json",
  "tab=Lists": "lists.json",
  "tab=Clients": "clients.json",
  "tab=Activations": "activations.json",
  "tab=Trackers&sub=sound&period=7": "trackers.json",
  "tab=Discovery&platform=TikTok": "discovery.json",
  [`tab=Campaign&campaign=${CAMPAIGN_ID}&sub=Posts`]: "campaign-posts.json",
  [`tab=Campaign&campaign=${CAMPAIGN_ID}&sub=Overview`]: "campaign-overview.json",
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
const summary = [];

async function openAndCapture(name, query, clickText, flow) {
  if (FORBIDDEN.test(clickText)) {
    console.error(`REFUSING ${name}: "${clickText}" matches the forbidden pattern`);
    return;
  }

  await page.goto(`${BASE}/dashboard?${query}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(5000);

  const target = page.getByText(clickText, { exact: true }).first();
  if ((await target.count()) === 0) {
    console.error(`${name}: "${clickText}" not found`);
    return;
  }
  await target.click({ timeout: 15_000 });
  await page.waitForTimeout(3000);

  const steps = [];
  for (let step = 0; step < (flow?.steps ?? 1); step += 1) {
    const data = await page.evaluate(CAPTURE);
    data.diff = newVsSurface(data, SURFACE_FILE[query]);
    steps.push(data);
    const stepName = flow?.steps > 1 ? `${name}-step${step + 1}` : name;
    writeFileSync(path.join(OUT, `${stepName}.json`), JSON.stringify(data, null, 2));
    await page.screenshot({ path: path.join(OUT, `${stepName}.png`) });
    console.log(
      `  ${stepName.padEnd(28)} +${String(data.diff?.newControls.length ?? 0).padStart(3)} controls, ` +
        `+${String(data.diff?.newText.length ?? 0).padStart(3)} text`,
    );

    if (!flow || step === flow.steps - 1) break;

    // Advancing is only safe if nothing on this step commits.
    const risky = data.controls.map((c) => c.label).filter((l) => FORBIDDEN.test(l));
    if (risky.length) {
      console.error(`  stopping ${name} at step ${step + 1}: found ${JSON.stringify(risky.slice(0, 3))}`);
      break;
    }
    const next = page.getByText(flow.next, { exact: true }).first();
    if ((await next.count()) === 0) break;
    await next.click({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }

  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  summary.push({ name, clickText, steps: steps.length });
}

try {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 60_000 });
  await page.waitForTimeout(6000);
  console.log("logged in\n");

  for (const [name, query, clickText, flow] of TARGETS) {
    console.log(`${name}  (click "${clickText}")`);
    try {
      await openAndCapture(name, query, clickText, flow);
    } catch (err) {
      console.error(`  ${name}: ${err.message.split("\n")[0]}`);
    }
  }

  writeFileSync(path.join(OUT, "index.json"), JSON.stringify(summary, null, 2));
  console.log(`\n${summary.length} targets opened → ${OUT}`);
} finally {
  await browser.close();
}
