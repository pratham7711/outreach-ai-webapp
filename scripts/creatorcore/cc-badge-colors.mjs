/**
 * CreatorCore's status and badge colours, as the browser computes them.
 *
 * The UI inventory captured text colour only, and a chip is a background as
 * much as a foreground, so this reads both -- walking up from the text node
 * until it finds an ancestor that actually paints a background, which is where
 * Bubble tends to put it.
 *
 * STRICTLY READ-ONLY. It signs in, navigates, and reads computed styles. It
 * clicks nothing except the login button and writes nothing to CreatorCore.
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";

const env = Object.fromEntries(
  readFileSync(".env", "utf8").split("\n")
    .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "")])
);
const EMAIL = process.env.CC_EMAIL || env.CC_EMAIL;
const PASSWORD = process.env.CC_PASSWORD || env.CC_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("CC_EMAIL and CC_PASSWORD must be set in webapp/.env (gitignored).");
  process.exit(1);
}

const BASE = "https://app.creatorcore.co";
const OUT = path.join(import.meta.dirname, "out");
mkdirSync(OUT, { recursive: true });

const SURFACES = [
  ["campaigns", "tab=Campaigns"],
  ["activations", "tab=Activations"],
  ["payouts", "tab=Payouts"],
  ["creators", "tab=Creators"],
];

const STATUS_WORDS = [
  "pending", "active", "complete", "completed", "canceled", "cancelled", "in-progress",
  "awaiting draft", "awaiting approval", "awaiting posting", "approved", "declined",
  "draft", "posted", "live", "paid", "unpaid", "overdue", "scheduled", "published",
  "rejected", "archived", "submitted", "revision", "new",
];

const scrape = (words) => {
  const out = [];
  const seen = new Set();
  const paints = (c) => c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent";
  for (const el of Array.from(document.querySelectorAll("div,span,p,td,button,a"))) {
    const txt = (el.textContent || "").trim();
    if (!txt || txt.length > 24) continue;
    if (!words.includes(txt.toLowerCase())) continue;
    // Innermost element carrying just this label.
    if (Array.from(el.children).some((c) => (c.textContent || "").trim() === txt)) continue;
    const cs = getComputedStyle(el);
    // The chip's fill is often on an ancestor, not the text node.
    let bg = cs.backgroundColor, radius = cs.borderRadius, node = el, hops = 0;
    while (!paints(bg) && node.parentElement && hops < 4) {
      node = node.parentElement; hops += 1;
      const p = getComputedStyle(node);
      if (paints(p.backgroundColor)) { bg = p.backgroundColor; radius = p.borderRadius; }
    }
    const rec = {
      label: txt,
      color: cs.color,
      background: paints(bg) ? bg : "none",
      borderRadius: radius,
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      padding: getComputedStyle(node).padding,
      border: getComputedStyle(node).border,
      textTransform: cs.textTransform,
    };
    const key = JSON.stringify(rec);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rec);
  }
  return out;
};

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await context.newPage();
const all = {};

try {
  await page.goto(`${BASE}/auth`, { waitUntil: "domcontentloaded" });
  await page.getByRole("textbox", { name: "Email" }).fill(EMAIL);
  await page.getByRole("textbox", { name: "Password" }).fill(PASSWORD);
  await page.getByRole("button", { name: "Login" }).click();
  await page.waitForURL((u) => !u.pathname.includes("/auth"), { timeout: 60_000 });
  await page.waitForTimeout(6000);
  console.log("signed in (read-only)\n");

  for (const [name, query] of SURFACES) {
    try {
      await page.goto(`${BASE}/dashboard?${query}`, { waitUntil: "domcontentloaded" });
      await page.waitForTimeout(7000);
      const rows = await page.evaluate(scrape, STATUS_WORDS);
      all[name] = rows;
      console.log(`${name}: ${rows.length} badge(s)`);
      for (const r of rows) {
        console.log(`   ${r.label.padEnd(18)} fg=${r.color.padEnd(20)} bg=${r.background.padEnd(22)} r=${r.borderRadius} ${r.fontSize}/${r.fontWeight}`);
      }
    } catch (err) {
      console.error(`${name}: ${err.message.split("\n")[0]}`);
    }
  }

  // The public client report, for its own styling. No auth involved.
  const pub = await context.newPage();
  await pub.goto("https://lkay.creatorcore.co/client/wherever-i-go-ellie-holcomb-8950325", { waitUntil: "domcontentloaded" });
  await pub.waitForTimeout(8000);
  all.publicReport = await pub.evaluate(() => {
    const body = getComputedStyle(document.body);
    const headings = Array.from(document.querySelectorAll("h1,h2,h3,div,span"))
      .filter((e) => {
        const t = (e.textContent || "").trim();
        return t && t.length < 40 && parseFloat(getComputedStyle(e).fontSize) >= 18;
      })
      .slice(0, 12)
      .map((e) => {
        const c = getComputedStyle(e);
        return { text: (e.textContent || "").trim().slice(0, 34), size: c.fontSize, weight: c.fontWeight, color: c.color, font: c.fontFamily.split(",")[0] };
      });
    return { bodyBg: body.backgroundColor, bodyColor: body.color, bodyFont: body.fontFamily.split(",")[0], headings };
  });
  console.log(`\npublic report: bg=${all.publicReport.bodyBg} font=${all.publicReport.bodyFont}`);
  for (const h of all.publicReport.headings) {
    console.log(`   ${h.size}/${h.weight} ${h.color.padEnd(20)} ${h.text}`);
  }
} catch (err) {
  console.error("ERROR:", err.message.split("\n")[0]);
} finally {
  writeFileSync(path.join(OUT, "badge-colors.json"), JSON.stringify(all, null, 2));
  console.log(`\nwritten to ${path.join(OUT, "badge-colors.json")}`);
  await browser.close();
}
