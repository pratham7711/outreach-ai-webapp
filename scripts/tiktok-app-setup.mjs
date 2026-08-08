import { chromium } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const PROFILE_DIR = join(homedir(), ".cache", "outreach-ai", "tiktok-profile");
const OUT_DIR = join(homedir(), ".cache", "outreach-ai", "tiktok-run");
const PORTAL = "https://developers.tiktok.com";

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => {
  const i = args.indexOf(f);
  return i === -1 ? null : args[i + 1];
};

export const FIELDS = (origin) => ({
  "app name": "Outreach AI",
  "app icon": null,
  "category": "Social Media Management",
  "description":
    "Outreach AI is a B2B campaign management tool for influencer marketing agencies. Agencies brief creators, track the posts those creators publish, and record payouts against them. Creators connect their own TikTok account from a creator portal so the agency can see the performance of the specific videos delivered for a campaign, instead of asking the creator to send screenshots.",
  "website url": origin,
  "terms of service url": `${origin}/terms`,
  "privacy policy url": `${origin}/privacy`,
  "redirect uri": `${origin}/api/portal/connections/tiktok/callback`,
});

const FORBIDDEN = /terms|agree|accept|consent|policy.*checkbox|submit|confirm|publish/i;

function usage() {
  console.log(`
tiktok-app-setup — drives the TikTok for Developers portal up to, but never through,
the Terms-of-Service checkbox or the final Submit button.

  --self-check                run the fill logic against a local fixture, no network
  --preflight                 check the VPN exit node only, then exit
  --login                     open the portal and wait for you to log in by hand
  --dump <url>                save DOM + screenshot of a portal page (for fixing selectors)
  --create --origin <https>   fill the app-creation fields, then stop for your review

  --headless                  only valid with --preflight/--dump

Profile: ${PROFILE_DIR}
Output:  ${OUT_DIR}
`);
}

async function exitNode() {
  const r = await fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(10_000) });
  if (!r.ok) throw new Error(`ipinfo returned ${r.status}`);
  return r.json();
}

async function preflight() {
  let info;
  try {
    info = await exitNode();
  } catch (e) {
    console.error(`Could not read the exit node: ${e.message}`);
    return false;
  }
  console.log(`Exit node: ${info.ip} — ${info.city ?? "?"}, ${info.country ?? "?"} (${info.org ?? "?"})`);
  if (info.country === "IN") {
    console.error(`
BLOCKED: exit node is in India. developers.tiktok.com is geo-blocked from Indian IPs
and will hang with no response at all.

Open ProtonVPN and Quick Connect to any non-India server, then re-run.
Proton has no macOS CLI, so this needs a click in their app — it cannot be automated
from here.`);
    return false;
  }
  const reachable = await fetch(PORTAL, { redirect: "manual", signal: AbortSignal.timeout(15_000) })
    .then((r) => r.status)
    .catch(() => 0);
  if (!reachable) {
    console.error(`\nBLOCKED: ${PORTAL} did not respond even on a ${info.country} exit node.`);
    return false;
  }
  console.log(`${PORTAL} responded ${reachable}. Portal is reachable.`);
  return true;
}

async function browser({ headless = false } = {}) {
  mkdirSync(PROFILE_DIR, { recursive: true });
  mkdirSync(OUT_DIR, { recursive: true });
  const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless,
    viewport: { width: 1440, height: 900 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
  return ctx;
}

async function loggedIn(page) {
  const cookies = await page.context().cookies();
  return cookies.some((c) => /sessionid|sid_tt|passport/i.test(c.name) && c.value);
}

async function login() {
  const ctx = await browser();
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(`${PORTAL}/login`, { waitUntil: "domcontentloaded" });
  console.log(`
Browser is open. Log in with your TikTok account, accept the Developer Terms of
Service if prompted, and land on the developer dashboard.

I am not typing credentials and not accepting terms on your behalf.
Waiting up to 10 minutes. The session is saved to the profile above, so you only
do this once.`);

  const deadline = Date.now() + 600_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    if (page.isClosed()) break;
    if (await loggedIn(page)) {
      console.log(`\nSession cookie present. Logged in. URL: ${page.url()}`);
      await page.screenshot({ path: join(OUT_DIR, "logged-in.png"), fullPage: true });
      await ctx.close();
      return true;
    }
  }
  console.log("\nTimed out without seeing a session cookie. Leaving the browser as-is.");
  return false;
}

async function dump(url) {
  const ctx = await browser({ headless: has("--headless") });
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const slug = url.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
  writeFileSync(join(OUT_DIR, `${slug}.html`), await page.content());
  await page.screenshot({ path: join(OUT_DIR, `${slug}.png`), fullPage: true });

  const controls = await page.evaluate(() => {
    const label = (el) => {
      const id = el.getAttribute("id");
      const byFor = id && document.querySelector(`label[for="${CSS.escape(id)}"]`);
      return (
        el.getAttribute("aria-label") ||
        byFor?.textContent?.trim() ||
        el.closest("label")?.textContent?.trim() ||
        el.getAttribute("placeholder") ||
        el.getAttribute("name") ||
        ""
      ).replace(/\s+/g, " ").slice(0, 80);
    };
    return [...document.querySelectorAll("input,textarea,select,button")].map((el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type"),
      label: label(el),
      text: el.tagName === "BUTTON" ? el.textContent.trim().slice(0, 40) : undefined,
    }));
  });
  writeFileSync(join(OUT_DIR, `${slug}.controls.json`), JSON.stringify(controls, null, 2));
  console.log(`Saved DOM, screenshot and ${controls.length} controls to ${OUT_DIR}`);
  console.table(controls);
  await ctx.close();
}

export async function fillByLabel(page, label, value) {
  if (!value) return "skipped (no value)";
  const rx = new RegExp(label.replace(/\s+/g, "\\s*"), "i");
  const candidates = [
    page.getByLabel(rx),
    page.getByPlaceholder(rx),
    page.locator(`textarea[name*="${label.split(" ")[0]}" i]`),
    page.locator(`input[name*="${label.split(" ")[0]}" i]`),
  ];
  for (const loc of candidates) {
    const n = await loc.count().catch(() => 0);
    if (!n) continue;
    const first = loc.first();
    const name = ((await first.getAttribute("name")) ?? "") + ((await first.getAttribute("aria-label")) ?? "");
    if (FORBIDDEN.test(name)) return "refused (looks like a consent control)";
    await first.scrollIntoViewIfNeeded();
    await first.fill(String(value));
    return `filled (${await first.inputValue().then((v) => `${v.length} chars`)})`;
  }
  return "NOT FOUND — run --dump on this page and fix the selector";
}

const FIXTURE = `<!doctype html><meta charset="utf-8"><form>
<label for="a">App name</label><input id="a" name="app_name">
<label for="c">Category</label><input id="c" name="category">
<label for="d">Description</label><textarea id="d" name="description"></textarea>
<label for="w">Website URL</label><input id="w" name="website_url">
<label for="t">Terms of Service URL</label><input id="t" name="tos_url">
<label for="p">Privacy Policy URL</label><input id="p" name="privacy_url">
<label for="r">Redirect URI</label><input id="r" name="redirect_uri">
<label for="x">I accept the Developer Terms of Service</label><input id="x" name="accept_terms_confirmation">
</form>`;

async function selfCheck() {
  const ORIGIN = "https://fixture.vercel.app";
  const b = await chromium.launch({ headless: true });
  const page = await b.newPage();
  await page.goto(`data:text/html,${encodeURIComponent(FIXTURE)}`);

  for (const [label, value] of Object.entries(FIELDS(ORIGIN))) {
    console.log(label.padEnd(24), await fillByLabel(page, label, value));
  }
  const got = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll("input,textarea")].map((el) => [el.name, el.value]))
  );

  const want = {
    app_name: "Outreach AI",
    category: "Social Media Management",
    website_url: ORIGIN,
    tos_url: `${ORIGIN}/terms`,
    privacy_url: `${ORIGIN}/privacy`,
    redirect_uri: `${ORIGIN}/api/portal/connections/tiktok/callback`,
  };
  let fail = 0;
  for (const [k, v] of Object.entries(want)) {
    if (got[k] !== v) {
      console.error(`FAIL ${k}: got ${JSON.stringify(got[k])} want ${JSON.stringify(v)}`);
      fail++;
    }
  }
  if (!got.description.startsWith("Outreach AI is a B2B")) {
    console.error("FAIL description not filled");
    fail++;
  }
  if (got.accept_terms_confirmation !== "") {
    console.error("FAIL consent control was filled as a side effect");
    fail++;
  }

  const refusal = await fillByLabel(page, "accept", "yes");
  console.log("consent control targeted directly ->", refusal);
  if (!/refused/.test(refusal)) {
    console.error("FAIL consent control was not refused");
    fail++;
  }
  if ((await page.locator("#x").inputValue()) !== "") {
    console.error("FAIL consent control has a value after the refusal");
    fail++;
  }

  await b.close();
  console.log(fail ? `\n${fail} FAILURES` : "\nself-check passed");
  return fail === 0;
}

async function create(origin) {
  if (!origin?.startsWith("https://")) {
    console.error("--origin must be an absolute https URL. TikTok rejects http and localhost.");
    process.exit(1);
  }
  const ctx = await browser();
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto(`${PORTAL}/apps`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  if (!(await loggedIn(page))) {
    console.error("No session cookie. Run with --login first.");
    await ctx.close();
    process.exit(1);
  }

  const connect = page.getByRole("button", { name: /create|new app/i }).first();
  if (await connect.count()) {
    await connect.click();
    await page.waitForTimeout(3000);
  } else {
    console.log("No obvious Create button found — assuming you already opened the form.");
  }

  const report = {};
  for (const [label, value] of Object.entries(FIELDS(origin))) {
    report[label] = await fillByLabel(page, label, value);
    console.log(`${label.padEnd(24)} ${report[label]}`);
  }

  await page.screenshot({ path: join(OUT_DIR, "create-filled.png"), fullPage: true });
  writeFileSync(join(OUT_DIR, "create-report.json"), JSON.stringify(report, null, 2));

  console.log(`
Screenshot: ${join(OUT_DIR, "create-filled.png")}

STOPPING HERE ON PURPOSE. Still yours to do, in the portal window that is open:
  1. tick the TikTok Developer Terms of Service checkbox
  2. add the Login Kit product
  3. request scopes: user.info.basic, video.list
  4. confirm the redirect URI reads exactly:
     ${origin}/api/portal/connections/tiktok/callback
  5. press Submit

Any field above that says NOT FOUND means the portal markup differs from my guess —
run  --dump ${PORTAL}/apps  and the control list will show the real labels.

The browser stays open. Ctrl-C when you are done.`);
  await new Promise(() => {});
}

if (import.meta.main) {
  if (has("--help") || args.length === 0) {
    usage();
  } else if (has("--self-check")) {
    process.exit((await selfCheck()) ? 0 : 1);
  } else if (has("--preflight")) {
    process.exit((await preflight()) ? 0 : 1);
  } else if (has("--dump")) {
    if (!(await preflight())) process.exit(1);
    await dump(val("--dump") ?? `${PORTAL}/apps`);
  } else if (has("--login")) {
    if (!(await preflight())) process.exit(1);
    await login();
  } else if (has("--create")) {
    if (!(await preflight())) process.exit(1);
    await create(val("--origin"));
  } else {
    usage();
    process.exit(1);
  }
}
