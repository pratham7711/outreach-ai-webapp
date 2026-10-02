/**
 * The Plan B switch drill (plan T7: "Switch drill passes"), against a local
 * server on the e2e test database. Nothing here reads TikTok.
 *
 *   TRACKER_PLAN_B_HEALTH_TOKEN=... node scripts/qa/switch-drill.mjs --out <dir>
 *
 * 1. A failing daily check: the real daily-check.mjs, run against a real
 *    fetch-server that was given the wrong token -- a broken worker, so every
 *    read fails without any request leaving this machine. Reported to
 *    /api/trackers/source-health. Then the switch to B must be refused.
 * 2. A passing daily check, run now: scripts/trackers/sandbox-daily-check.mts
 *    boots the real fetch-server in a throwaway Sandbox and runs the real
 *    check through it. Reported, then the ops page's switch to B, through its
 *    confirm step, must succeed.
 * 3. Back to the position the drill found, so the test database is left as it
 *    was.
 * Screenshots of the ops page at each step go to --out.
 */
import { chromium } from "@playwright/test";
import { execFile, spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const argv = process.argv.slice(2);
const arg = (n, d) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);
const BASE = arg("base", "http://localhost:3009");
const OUT = path.resolve(arg("out", path.join(ROOT, "docs", "qa", "drill")));
const HEALTH_TOKEN = process.env.TRACKER_PLAN_B_HEALTH_TOKEN;
if (!HEALTH_TOKEN) throw new Error("TRACKER_PLAN_B_HEALTH_TOKEN is required (the local server's value)");
mkdirSync(OUT, { recursive: true });

const log = [];
const step = (name, data) => {
  log.push({ step: name, at: new Date().toISOString(), ...data });
  console.log(`${name}: ${JSON.stringify(data)}`);
};

async function report(body) {
  const res = await fetch(`${BASE}/api/trackers/source-health`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${HEALTH_TOKEN}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

function run(cmd, args, env) {
  return new Promise((resolve) => {
    execFile(cmd, args, { env: { ...process.env, ...env }, cwd: ROOT, timeout: 480_000 }, (err, stdout, stderr) =>
      resolve({ code: err ? (err.code ?? 1) : 0, stdout: String(stdout), stderr: String(stderr) })
    );
  });
}

async function main() {
  // 1. A broken worker: the service runs, but the check holds the wrong token.
  const serverToken = randomBytes(24).toString("hex");
  const server = spawn("node", ["scripts/creator-worker/fetch-server.mjs"], {
    cwd: ROOT,
    env: { ...process.env, FETCH_TOKEN: serverToken, FETCH_PORT: "18787", FETCH_HOST: "127.0.0.1" },
    stdio: "ignore",
  });
  await new Promise((r) => setTimeout(r, 800));
  const broken = await run("node", ["scripts/creator-worker/daily-check.mjs", "--no-report"], {
    FETCH_URL: "http://127.0.0.1:18787",
    FETCH_TOKEN: randomBytes(24).toString("hex"),
  });
  server.kill();
  const failingLine = broken.stdout.split("\n").find((l) => l.startsWith("{"));
  const failing = JSON.parse(failingLine);
  delete failing.network;
  delete failing.where;
  step("failing check ran", { reads: failing.reads, proper: failing.proper, failures: failing.failures, passed: failing.passed });
  step("failing check reported", await report(failing).then((r) => ({ status: r.status, ok: r.body?.ok, alerted: r.body?.alerted })));

  const browser = await chromium.launch({ channel: "chrome" });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    storageState: JSON.parse(readFileSync(path.join(ROOT, "e2e", "fixtures", ".auth.json"), "utf8")),
  });
  const page = await ctx.newPage();
  const api = (method, body) =>
    page.evaluate(
      async ([m, b]) => {
        const r = await fetch("/api/platform/tracker-source", {
          method: m,
          headers: { "content-type": "application/json" },
          body: b ? JSON.stringify(b) : undefined,
        });
        return { status: r.status, body: await r.json().catch(() => null) };
      },
      [method, body]
    );

  await page.goto(`${BASE}/platform/trackers`, { waitUntil: "networkidle" });
  const before = await api("GET");
  const found = before.body?.plan ?? null;
  step("switch as found", { status: before.status, switch: found });
  await page.screenshot({ path: path.join(OUT, "1-after-failing-check.png"), fullPage: true });

  const refused = await api("POST", { position: "B", note: "drill: B after a failing check" });
  step("switch to B after the failing check", { status: refused.status, error: refused.body?.error ?? null });

  // 2. A real passing check, through a real worker, now.
  const sbRun = await run("npx", ["tsx", "scripts/trackers/sandbox-daily-check.mts"], {});
  const passing = JSON.parse(sbRun.stdout.split("\n").find((l) => l.startsWith("{")) ?? "null");
  if (!passing) throw new Error(`the sandbox daily check produced no result: ${sbRun.stderr.slice(-400)}`);
  step("passing check ran", { reads: passing.reads, proper: passing.proper, embeds: passing.embeds, passed: passing.passed, worker: passing.worker });
  step("passing check reported", await report(passing).then((r) => ({ status: r.status, ok: r.body?.ok })));
  await page.reload({ waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(OUT, "2-after-passing-check.png"), fullPage: true });

  // Through the page's own confirm step, as an operator would.
  await page.getByRole("radio", { name: /Plan B/ }).click();
  await page.getByRole("button", { name: "Review switch" }).click();
  await page.getByRole("alertdialog", { name: "Confirm switch" }).waitFor();
  await page.screenshot({ path: path.join(OUT, "3-confirm-step.png"), fullPage: true });
  await page.getByRole("button", { name: "Confirm switch" }).click();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(800);
  const afterB = await api("GET");
  step("switch after confirming B in the page", { position: afterB.body?.plan?.position, effective: afterB.body?.plan?.effective });
  await page.screenshot({ path: path.join(OUT, "4-on-B.png"), fullPage: true });

  // 3. Back to where the drill found it.
  const restorePosition = found?.position ?? "legacy";
  const restored = await api("POST", {
    position: restorePosition,
    scopeOrgIds: found?.scopeOrgIds ?? [],
    percent: found?.percent ?? 100,
    note: "drill: restore",
  });
  step("restored", { status: restored.status, position: restorePosition });
  await page.reload({ waitUntil: "networkidle" });
  await page.screenshot({ path: path.join(OUT, "5-restored.png"), fullPage: true });
  await browser.close();
  writeFileSync(path.join(OUT, "drill.json"), JSON.stringify(log, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
