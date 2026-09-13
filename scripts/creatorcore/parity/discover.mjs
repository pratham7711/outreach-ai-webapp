/**
 * Refreshes fixtures.json -- the three campaigns the campaign sub-tab surfaces
 * are captured against.
 *
 *   node scripts/creatorcore/parity/discover.mjs
 *
 * This exists because campaign ids are NOT stable. The id hardcoded in
 * cc-ui-inventory.mjs (1749303629139x526598772507279360) no longer exists in
 * this org, so every campaign surface that script captured would be an error
 * page that screenshots perfectly well.
 *
 * Three fixtures, not one, because data volume changes layout: the busiest
 * campaign, a mid-sized one, and the quietest. The quiet one is kept precisely
 * AS the empty case rather than skipped for being too quiet to spec from.
 *
 * Navigation-only. The single click is on a campaign card, which opens it.
 */
import { chromium } from "playwright";
import { ensureSession, waitForAppReady, STATE_FILE } from "./auth.mjs";
import { loadSecrets, refUrl } from "./secrets.mjs";

const { baseUrl } = loadSecrets();
const browser = await chromium.launch({ headless: true, channel: "chrome" });
try {
  await ensureSession(browser);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, storageState: STATE_FILE });
  const page = await context.newPage();
  await page.goto(refUrl(baseUrl, "/dashboard?tab=Campaigns"), { waitUntil: "domcontentloaded" });
  await waitForAppReady(page);
  await page.waitForTimeout(6000);

  // Each campaign card repeats the same label sequence, so the card is found by
  // the shape of its own text rather than by a class Bubble regenerates.
  const cards = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll("div")) {
      const t = (el.innerText || "").trim();
      if (!/\bLast Updated\b/.test(t) || !/\bPosts\b/.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 200 || r.height < 40 || r.height > 260) continue;
      const lines = t.split("\n").map((s) => s.trim()).filter(Boolean);
      const posts = Number(lines[lines.indexOf("Posts") + 1]);
      const creators = Number(lines[lines.indexOf("Creators") + 1]);
      if (!Number.isFinite(posts)) continue;
      out.push({ name: lines[0], posts, creators, y: r.y, h: r.height });
    }
    // Innermost match wins: the outer list container also contains the words.
    const seen = new Map();
    for (const c of out.sort((a, b) => a.h - b.h)) if (!seen.has(c.name)) seen.set(c.name, c);
    return [...seen.values()].sort((a, b) => b.posts - a.posts);
  });

  console.log(`campaigns: ${cards.length}`);
  for (const c of cards) console.log(`  ${String(c.posts).padStart(4)} posts  ${c.creators} creators  ${c.name}`);

  // Three fixtures: busiest, a mid-sized reference, and the quietest non-zero.
  const busy = cards[0];
  const mid = cards[Math.floor(cards.length / 2)];
  const quiet = [...cards].reverse()[0];
  const picks = [["busy", busy], ["reference", mid], ["quiet", quiet]].filter(([, c]) => c);

  const resolved = {};
  for (const [role, c] of picks) {
    await page.goto(refUrl(baseUrl, "/dashboard?tab=Campaigns"), { waitUntil: "domcontentloaded" });
    await waitForAppReady(page);
    await page.waitForTimeout(4000);
    await page.getByText(c.name, { exact: true }).first().click();
    await page.waitForFunction(() => location.search.includes("campaign="), null, { timeout: 30_000 });
    const id = new URL(page.url()).searchParams.get("campaign");
    resolved[role] = { id, name: c.name, posts: c.posts };
    console.log(`${role}: ${id}  (${c.name}, ${c.posts} posts)`);
  }
  console.log("\nFIXTURES_JSON " + JSON.stringify(resolved));
  await context.close();
} finally {
  await browser.close();
}
