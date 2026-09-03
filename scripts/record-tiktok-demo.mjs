import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

/* TikTok's web rule: the demo video's domain must match the submitted
   Website URL. This was hardcoded to app.prathamsharma.in, which no longer
   resolves at all -- a recording made with it would have failed review for
   the same field that failed last time. Defaults to the submitted domain
   and stays overridable for a local rehearsal. */
const APP = process.env.DEMO_APP_URL || "https://campaign.madeboring.com";
const CREATOR_ID = process.env.DEMO_CREATOR_ID;
const STATE = process.env.DEMO_STATE || "/Users/pratham/.playwright-mcp/demo-state.json";
const OUT_DIR = process.env.DEMO_OUT || "/Users/pratham/.playwright-mcp/demo";

if (!CREATOR_ID) {
  console.error("DEMO_CREATOR_ID is required");
  process.exit(1);
}

const CURSOR_INIT = `
window.addEventListener('DOMContentLoaded', () => {
  const dot = document.createElement('div');
  dot.id = '__demo_cursor';
  Object.assign(dot.style, {
    position: 'fixed', width: '18px', height: '18px', borderRadius: '50%',
    background: 'rgba(20,20,30,0.55)', border: '2px solid #fff',
    boxShadow: '0 2px 8px rgba(0,0,0,0.35)', pointerEvents: 'none',
    zIndex: '2147483647', transform: 'translate(-50%, -50%)',
    left: '-100px', top: '-100px', transition: 'width .08s, height .08s',
  });
  document.documentElement.appendChild(dot);
  document.addEventListener('mousemove', (e) => {
    dot.style.left = e.clientX + 'px';
    dot.style.top = e.clientY + 'px';
  }, true);
  document.addEventListener('mousedown', () => {
    dot.style.width = '30px'; dot.style.height = '30px';
  }, true);
  document.addEventListener('mouseup', () => {
    dot.style.width = '18px'; dot.style.height = '18px';
  }, true);
});
`;

async function caption(page, text) {
  await page.evaluate((t) => {
    let el = document.getElementById("__demo_caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "__demo_caption";
      Object.assign(el.style, {
        position: "fixed",
        left: "0",
        right: "0",
        bottom: "0",
        padding: "14px 24px",
        background: "rgba(15,17,32,0.92)",
        color: "#fff",
        font: "600 17px/1.4 -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
        textAlign: "center",
        zIndex: "2147483646",
        pointerEvents: "none",
      });
      document.documentElement.appendChild(el);
    }
    el.textContent = t;
  }, text);
}

async function clickAt(page, locator, pause = 500) {
  await locator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  const box = await locator.boundingBox();
  if (!box) throw new Error("element has no box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y, { steps: 30 });
  await page.waitForTimeout(pause);
  await page.mouse.click(x, y);
}

async function scrollTo(page, y, ms = 1400) {
  await page.evaluate((target) => window.scrollTo({ top: target, behavior: "smooth" }), y);
  await page.waitForTimeout(ms);
}

async function scrollToText(page, text, ms = 1600, block = "center") {
  await page.evaluate(
    ({ t, b }) => {
      const el = [...document.querySelectorAll("h1,h2,h3,div,span")].find(
        (e) => e.children.length === 0 && e.textContent.trim() === t,
      );
      if (el) el.scrollIntoView({ behavior: "smooth", block: b });
    },
    { t: text, b: block },
  );
  await page.waitForTimeout(ms);
}

async function settle(page, text, timeout = 25000) {
  await page.waitForLoadState("networkidle").catch(() => {});
  if (text) await page.getByText(text, { exact: false }).first().waitFor({ timeout }).catch(() => {});
  await page.waitForTimeout(700);
}

async function settleButton(page, name, timeout = 30000) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("button", { name }).first().waitFor({ timeout }).catch(() => {});
  await page.waitForTimeout(900);
}

fs.mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({
  storageState: STATE,
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 800 } },
});
await context.addInitScript(CURSOR_INIT);
const page = await context.newPage();

try {
  // Start from a disconnected state so the take is repeatable.
  const existing = await page.request.get(`${APP}/api/portal/connections`);
  if (existing.ok()) {
    const body = await existing.json();
    const tiktok = (body.accounts || []).find((a) => a.platform === "TIKTOK");
    if (tiktok) await page.request.delete(`${APP}/api/portal/connections?id=${tiktok.id}`);
  }

  // Beat 1 — the product
  await page.goto(`${APP}/portal/dashboard`, { waitUntil: "domcontentloaded" });
  await settle(page, "Dashboard");
  await page.waitForTimeout(1500);
  await caption(page, "Made Boring Campaigns — campaign management for talent agencies. This is a creator's account.");
  await page.waitForTimeout(3500);

  // Beat 2 — where the connection lives
  await page.goto(`${APP}/portal/settings`, { waitUntil: "domcontentloaded" });
  await settleButton(page, /^Connect$/);
  await caption(page, "The creator opens Settings to link the accounts an agency can report on.");
  await scrollToText(page, "Connected Accounts");
  await page.waitForTimeout(2500);

  // Beat 3 — start the connection
  await caption(page, "Connecting TikTok is optional and always started by the account holder.");
  // Connected Accounts lists Instagram, TikTok, YouTube in that order.
  const connectBtn = page.getByRole("button", { name: "Connect" }).nth(1);
  await page.waitForTimeout(1500);
  await clickAt(page, connectBtn, 700);

  // Beat 4 — TikTok's own consent screen, scope by scope
  await page.waitForURL(/tiktok\.com/, { timeout: 30000 });
  await page.waitForTimeout(3500);
  await page.mouse.move(640, 300, { steps: 20 });
  await scrollTo(page, 120, 1600);
  await page.waitForTimeout(2200);
  await scrollTo(page, 260, 1600);
  await page.waitForTimeout(2200);
  await scrollTo(page, 0, 1200);
  await page.waitForTimeout(1500);

  const cont = page.getByRole("button", { name: "Continue" });
  if (await cont.count()) {
    await clickAt(page, cont.first(), 900);
  }

  // Beat 5 — back in the app, connected
  await page.waitForURL(/app\.prathamsharma\.in\/portal\/settings/, { timeout: 30000 });
  await settleButton(page, /^Disconnect$/);
  await scrollToText(page, "Connected Accounts");
  await caption(page, "The account is linked. Tokens are encrypted at rest with AES-256-GCM.");
  await page.waitForTimeout(3500);

  // Beat 6 — what the agency sees: profile, follower count and post performance
  await page.goto(`${APP}/creators/${CREATOR_ID}`, { waitUntil: "domcontentloaded" });
  await settleButton(page, /^Social Accounts$/);
  await caption(page, "The agency's view of that creator — profile read with user.info.basic and user.info.profile.");
  await page.waitForTimeout(3500);

  const socialTab = page.getByRole("button", { name: /Social Accounts/i }).first();
  if (await socialTab.count()) {
    await clickAt(page, socialTab, 700);
  } else {
    await page.getByText("Social Accounts").first().click();
  }
  await settle(page, "TikTok posts");
  await caption(page, "Follower count comes from user.info.stats — it is what campaign fees are agreed against.");
  await page.waitForTimeout(3000);
  await caption(page, "Public posts and their view, like, comment and share counts come from video.list.");
  await scrollToText(page, "TikTok posts", 1800, "start");
  await page.waitForTimeout(6000);

  // Beat 7 — revoke and the policy that matches it
  await page.goto(`${APP}/portal/settings`, { waitUntil: "domcontentloaded" });
  await settleButton(page, /^Disconnect$/);
  await caption(page, "The creator can disconnect at any time.");
  await scrollToText(page, "Connected Accounts");
  const disconnect = page.getByRole("button", { name: "Disconnect" }).first();
  if (await disconnect.count()) {
    await clickAt(page, disconnect, 800);
    await page.waitForTimeout(3500);
    await caption(page, "Disconnecting revokes the token with TikTok and deletes it from our database.");
    await page.waitForTimeout(3000);
  }

  await page.goto(`${APP}/privacy`, { waitUntil: "domcontentloaded" });
  await settle(page, "TikTok data handling");
  await caption(page, "Our privacy policy documents every TikTok permission and how the data is deleted.");
  await scrollToText(page, "TikTok data handling", 2000);
  await page.waitForTimeout(4000);
} finally {
  const video = page.video();
  await context.close();
  await browser.close();
  if (video) {
    const p = await video.path();
    const dest = path.join(OUT_DIR, "tiktok-demo.webm");
    fs.renameSync(p, dest);
    console.log(dest);
  }
}
