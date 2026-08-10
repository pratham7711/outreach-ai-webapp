import { chromium } from "playwright";

const APP = process.env.VERIFY_APP || "http://localhost:3009";
const stamp = process.env.VERIFY_STAMP || "x";
const email = `qa.signup.${stamp}@example.com`;
const password = "Qa!verify2026";
const org = `QA Signup ${stamp}`;

const browser = await chromium.launch({ headless: true });
const results = [];

async function step(name, fn) {
  try {
    const detail = await fn();
    results.push({ name, ok: true, detail });
  } catch (err) {
    results.push({ name, ok: false, detail: err.message.split("\n")[0] });
  }
}

async function typeInto(page, label, value, exact = false) {
  await page.getByLabel(label, exact ? { exact: true } : {}).click();
  await page.keyboard.type(value, { delay: 12 });
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

await step("signup page renders", async () => {
  const res = await page.goto(`${APP}/signup`, { waitUntil: "domcontentloaded" });
  await page.getByLabel("Organization name").waitFor({ timeout: 20000 });
  return `HTTP ${res.status()}`;
});

await step("signup creates an account", async () => {
  await typeInto(page, "Organization name", org);
  await typeInto(page, "Your name", "QA Verifier");
  await typeInto(page, "Email", email);
  await typeInto(page, "Password", password, true);
  await typeInto(page, "Confirm password", password);
  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/login\?registered=1/, { timeout: 45000 });
  return "redirected to /login?registered=1";
});

await step("sign in with the new account", async () => {
  await typeInto(page, "Email", email);
  await typeInto(page, "Password", password, true);
  await page.getByRole("button", { name: /sign in/i }).first().click();
  await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 45000 });
  return `landed on ${new URL(page.url()).pathname}`;
});

await step("session reaches an authenticated page", async () => {
  await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const path = new URL(page.url()).pathname;
  if (path.includes("/login")) throw new Error("bounced to /login");
  return `on ${path}`;
});

await step("protected route redirects when signed out", async () => {
  await ctx.clearCookies();
  await page.goto(`${APP}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const path = new URL(page.url()).pathname;
  if (!path.includes("/login")) throw new Error(`no redirect to login, got ${path}`);
  return "redirects to /login";
});

await step("sign in rejects a wrong password", async () => {
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  await p2.goto(`${APP}/login`, { waitUntil: "domcontentloaded" });
  await typeInto(p2, "Email", email);
  await typeInto(p2, "Password", "definitely-wrong", true);
  await p2.getByRole("button", { name: /sign in/i }).first().click();
  await p2.waitForTimeout(7000);
  const path = new URL(p2.url()).pathname;
  await ctx2.close();
  if (!path.includes("/login")) throw new Error(`wrong password got in, landed on ${path}`);
  return "stayed on /login";
});

await browser.close();

console.log(JSON.stringify({ email, org, results }, null, 2));
process.exit(results.some((r) => !r.ok) ? 1 : 0);
