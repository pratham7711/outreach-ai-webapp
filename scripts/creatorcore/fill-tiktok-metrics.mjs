/**
 * Fill in the TikTok half of a campaign, once TikTok is actually reachable.
 *
 * Why this exists as a script you run rather than something that already ran:
 * TikTok's web pages are DNS-blackholed on Indian ISPs, so on a machine in
 * India every TikTok post in a campaign syncs to zero and every tracked sound
 * stays without a snapshot. Nothing about that is a bug in the pipeline -- the
 * same pipeline pulls Instagram fine from the same machine -- so the fix is to
 * run it from somewhere with egress, not to change it.
 *
 * Run it with a VPN connected, or from a host outside the blocked region:
 *
 *   node scripts/creatorcore/fill-tiktok-metrics.mjs <campaignId>
 *
 * It refuses to do anything until it has confirmed reachability, so a run from
 * a blocked network cannot quietly stamp zeros over real numbers.
 *
 * Needs a dev server on PORT (default 3009) and the admin login, because it
 * drives the app's own sync routes rather than writing to the database.
 */
import { chromium } from "playwright";

const BASE = process.env.APP_URL ?? "http://localhost:3009";
const EMAIL = process.env.SYNC_EMAIL ?? "admin@demo.com";
const PASSWORD = process.env.SYNC_PASSWORD ?? "admin123";
const campaignId = process.argv[2];

if (!campaignId) {
  console.error("usage: node scripts/creatorcore/fill-tiktok-metrics.mjs <campaignId>");
  process.exit(1);
}

/** One HEAD-ish fetch, to prove TikTok answers at all before we sync anything. */
async function tiktokReachable() {
  try {
    const res = await fetch("https://www.tiktok.com/@nba", {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36" },
      signal: AbortSignal.timeout(15000),
    });
    return { ok: res.ok || res.status === 302, status: res.status };
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) };
  }
}

let egress = null;
try {
  const r = await fetch("https://ipinfo.io/json", { signal: AbortSignal.timeout(8000) });
  if (r.ok) {
    const d = await r.json();
    egress = [d.ip, d.country, d.org].filter(Boolean).join(" ");
  }
} catch {
  /* not fatal: the reachability check below is the one that matters */
}
console.log("egress:", egress ?? "(unknown)");

const reach = await tiktokReachable();
console.log("tiktok.com:", reach.ok ? `reachable (${reach.status})` : `UNREACHABLE ${reach.error ?? reach.status}`);
if (!reach.ok) {
  console.error(
    "\nRefusing to sync. Every TikTok post would come back empty and overwrite\n" +
    "whatever is stored with zeros. Connect a VPN outside the blocked region, or\n" +
    "run this from a host that can reach tiktok.com, and try again."
  );
  process.exit(2);
}

const browser = await chromium.launch();
const page = await browser.newPage();

// Filling straight after navigation races React's hydration, which resets the
// controlled inputs; read the values back before submitting.
await page.goto(`${BASE}/login`, { waitUntil: "load" });
await page.waitForSelector('input[type="email"]', { state: "visible", timeout: 30_000 });
for (let attempt = 1; attempt <= 5; attempt++) {
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.waitForTimeout(400);
  const kept = await page.evaluate(
    (e) => document.querySelector('input[type="email"]')?.value === e,
    EMAIL,
  );
  if (kept) break;
  if (attempt === 5) throw new Error("login form never kept its values");
}
await page.click('button[type="submit"]');
await page.waitForSelector("text=Campaigns & Reporting", { timeout: 60_000 });
const api = page.request;

const posts = await (await api.get(`${BASE}/api/campaigns/${campaignId}/posts`)).json();
const tiktok = (posts.posts ?? []).filter((p) => p.platform === "TIKTOK");
console.log(`\n${tiktok.length} TikTok posts on this campaign`);

let synced = 0;
let failed = 0;
for (const p of tiktok) {
  const res = await api.post(`${BASE}/api/campaigns/${campaignId}/posts/${p.id}/sync`);
  const body = await res.json().catch(() => ({}));
  const views = body.post?.viewsCount ?? body.viewsCount ?? null;
  const thumb = body.post?.thumbnailUrl ?? body.thumbnailUrl ?? null;
  if (res.status() < 300) synced++;
  else failed++;
  console.log(
    `  ${res.status()}  views=${views ?? "-"} thumb=${thumb ? "yes" : "no"}  ` +
    `${(p.creator?.handle ?? "?").padEnd(20)} ${p.postUrl.slice(0, 58)}`,
  );
  // TikTok answers a burst of page loads with a challenge; spacing them out is
  // the difference between 14 syncs and 14 challenge pages.
  await page.waitForTimeout(2500);
}
console.log(`\nposts: ${synced} synced, ${failed} failed`);

/* The audio card's Uses and usage curve come from the TikTok music page, which
   is behind the same block, so it is worth doing in the same run. That route is
   cron-authenticated rather than session-authenticated, so it needs the secret;
   without one, say so instead of failing silently. */
const cronSecret = process.env.CRON_SECRET;
if (cronSecret) {
  const res = await api.get(`${BASE}/api/cron/snapshot-sounds`, {
    headers: { authorization: `Bearer ${cronSecret}` },
  });
  console.log(`\nsound snapshot: ${res.status()} ${(await res.text()).slice(0, 300)}`);
} else {
  console.log(
    "\nsound snapshot: skipped, no CRON_SECRET in the environment. Run it with\n" +
    "  CRON_SECRET=… node --env-file=.env scripts/creatorcore/fill-tiktok-metrics.mjs <id>\n" +
    "  to fill Audio Uses and the usage curve too.",
  );
}

await browser.close();
