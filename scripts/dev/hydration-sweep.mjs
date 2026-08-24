/**
 * Which pages disagree with themselves between the server render and the
 * browser's? Read-only.
 *
 * A hydration mismatch caused by a date is invisible in development, because
 * the server and the browser are one machine in one timezone and format an
 * instant identically. Production splits them -- Node in UTC, the reader
 * wherever they are -- which is why the client report threw React #418 on every
 * load while local was clean.
 *
 * Run the dev server with TZ=UTC and this reproduces that split locally, so the
 * fix can be checked without a deploy:
 *
 *     TZ=UTC PORT=3009 npm run dev
 *     node scripts/dev/hydration-sweep.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3009";
const ROUTES = (process.env.ROUTES ?? [
  "/dashboard",
  "/campaigns",
  "/creators",
  "/payouts",
  "/analytics",
  "/inbox",
  "/recipients",
  "/connections",
  "/trackers",
  "/activations",
  "/reports",
  "/settings/team",
  "/settings/api-keys",
].join(",")).split(",");

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

console.log(`server timezone split: browser is ${
  await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
}, dev server should be UTC\n`);

for (let i = 0; i < 3; i += 1) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("you@example.com").fill("admin@demo.com");
  await page.getByPlaceholder("Enter your password").fill("admin123");
  await page.getByRole("button", { name: /^sign in$/i }).first().click();
  try {
    await page.waitForURL((u) => !u.pathname.includes("/login"), { timeout: 45_000 });
    break;
  } catch {}
}

const offenders = [];
for (const route of ROUTES) {
  const errs = [];
  const onErr = (e) => errs.push(e.message.split("\n")[0].slice(0, 80));
  page.on("pageerror", onErr);
  try {
    await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(3500);
  } catch (e) {
    errs.push(`NAV FAILED ${e.message.split("\n")[0].slice(0, 50)}`);
  }
  page.off("pageerror", onErr);

  /* Only hydration complaints matter here; an unrelated runtime error is a
     different bug and saying so keeps this from becoming a general error sweep
     that nobody trusts. */
  const hydration = errs.filter((e) => /#41[89]|#42[0-6]|[Hh]ydrat/.test(e));
  const other = errs.filter((e) => !hydration.includes(e));
  if (hydration.length) offenders.push(route);
  console.log(
    `${route.padEnd(22)} hydration=${hydration.length}  other=${other.length}  ${
      [...hydration, ...other].slice(0, 2).join(" | ")
    }`
  );
}

console.log(
  offenders.length
    ? `\n${offenders.length} route(s) disagree with their own server render: ${offenders.join(", ")}`
    : "\nno route disagrees with its own server render"
);
await browser.close();
