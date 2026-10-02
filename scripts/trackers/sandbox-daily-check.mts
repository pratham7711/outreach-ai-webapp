/**
 * Plan B's daily check, run now, through a real fetch-server in a throwaway
 * Sandbox: scripts/creator-worker/fetch-server.mjs is booted in iad1, the
 * real daily-check.mjs reads its 12 profiles and 3 embeds through it from this
 * machine, and the sandbox is deleted. Prints the check's JSON line, or writes
 * it to --out. Used by scripts/qa/switch-drill.mjs; reads no database.
 *
 *   npx tsx scripts/trackers/sandbox-daily-check.mts [--out <file>] [--region iad1]
 */
import { execFile, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const argv = process.argv.slice(2);
const arg = (n: string, d?: string) => (argv.includes(`--${n}`) ? argv[argv.indexOf(`--${n}`) + 1] : d);

/* The CLI's token lives about eight hours; whoami refreshes it. */
execFileSync("vercel", ["whoami"], { stdio: "ignore", timeout: 40_000 });
const cliDir = path.join(os.homedir(), "Library/Application Support/com.vercel.cli");
const credentials = {
  token: JSON.parse(fs.readFileSync(path.join(cliDir, "auth.json"), "utf8")).token as string,
  teamId: JSON.parse(fs.readFileSync(path.join(cliDir, "config.json"), "utf8")).currentTeam as string,
  projectId: "prj_qG6uzSDP9ZLrJytmCGE4mlp20knf",
};

const { Sandbox } = await import("@vercel/sandbox");
const token = randomBytes(24).toString("hex");
const sb = await Sandbox.create({
  runtime: "node22",
  region: arg("region", "iad1"),
  ports: [8787],
  timeout: 6 * 60_000,
  persistent: false,
  resources: { vcpus: 1 },
  ...credentials,
} as Parameters<typeof Sandbox.create>[0]);
try {
  await sb.writeFiles([{ path: "fetch-server.mjs", content: fs.readFileSync("scripts/creator-worker/fetch-server.mjs") }]);
  await sb.runCommand({ cmd: "node", args: ["fetch-server.mjs"], env: { FETCH_TOKEN: token, FETCH_HOST: "0.0.0.0", FETCH_PORT: "8787" }, detached: true });
  const url = sb.domain(8787);
  for (let i = 0; i < 30; i++) {
    if (await fetch(`${url}/healthz`).then((r) => r.ok).catch(() => false)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const out = await new Promise<string>((resolve) =>
    execFile(
      "node",
      ["scripts/creator-worker/daily-check.mjs", "--no-report"],
      { env: { ...process.env, FETCH_URL: url, FETCH_TOKEN: token }, timeout: 240_000 },
      (_e, stdout) => resolve(String(stdout))
    )
  );
  const line = out.split("\n").find((l) => l.startsWith("{"));
  if (!line) throw new Error("the daily check printed no result");
  const result = JSON.parse(line);
  /* Where the check ran from is this laptop, not the worker; drop it rather
     than report the wrong network. */
  delete result.network;
  delete result.where;
  result.worker = "vercel-sandbox-" + arg("region", "iad1");
  const json = JSON.stringify(result);
  if (arg("out")) fs.writeFileSync(arg("out")!, json + "\n");
  console.log(json);
} finally {
  await sb.delete({ deleteOrphanSnapshots: true }).catch(() => {});
}
