/**
 * The parity loop driver.
 *
 * One command runs one iteration end to end and appends its score to a history
 * file, so convergence is a number that moves rather than a feeling. The steps,
 * in the order they have to run and with the reason each one is where it is:
 *
 *   1  warm     every route is fetched before anything is measured. A cold
 *                Turbopack cache does NOT time out -- it serves Next's runtime
 *                error overlay with HTTP 200, which screenshots cleanly and
 *                reports "156 ok / 0 failed". On 2026-09-14 that turned a
 *                broken capture into an apparent 800 -> 186 improvement. The
 *                only tell was the resolution rate. Never skip this step.
 *   2  capture  our side, one BrowserContext per viewport, no resize.
 *   3  measure  landmark-level property diff  -> docs/parity/REPORT.md
 *   4  structure  node-level tree diff         -> docs/parity/structure/
 *   5  critique   design laws over our tree    -> docs/parity/critique/
 *   6  review     side-by-side composites      -> docs/parity/review/
 *   7  score      one line appended to docs/parity/history.jsonl
 *
 * Steps 3-6 are independent of each other and all consume step 2, so a failure
 * in one does not invalidate the others; each is reported separately rather
 * than aborting the run.
 *
 * The reference side is NOT re-captured here. It needs a login to someone
 * else's product, it is read-only, and it changes on their release schedule,
 * not ours -- re-capturing it every iteration would be both rude and noisy.
 * Run capture.mjs by hand when their product actually changes.
 *
 * Usage:
 *   node scripts/creatorcore/parity/loop.mjs [--viewport desktop-1600]
 *                                            [--base http://localhost:3009]
 *                                            [--skip review]
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, appendFileSync, readFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const opt = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const VP = opt("--viewport", "desktop-1600");
const BASE = opt("--base", "http://localhost:3009");
const SKIP = new Set((opt("--skip", "") || "").split(",").filter(Boolean));

const latest = (b) => {
  if (!existsSync(b)) return null;
  const r = readdirSync(b).filter((d) => /^\d{4}-/.test(d)).sort();
  return r.length ? path.join(b, r[r.length - 1]) : null;
};

const run = (label, cmd, args) => {
  if (SKIP.has(label)) { console.log(`\n── ${label} (skipped)`); return { ok: true, skipped: true }; }
  console.log(`\n── ${label}\n   ${cmd} ${args.join(" ")}`);
  const t = Date.now();
  const r = spawnSync(cmd, args, { stdio: "inherit" });
  const ms = Date.now() - t;
  const ok = r.status === 0;
  console.log(`   ${ok ? "ok" : `FAILED (exit ${r.status})`} in ${(ms / 1000).toFixed(1)}s`);
  return { ok, ms };
};

const steps = {};

steps.warm = run("warm", "node", ["scripts/creatorcore/parity/warm.mjs"]);
steps.capture = run("capture", "node", [
  "scripts/creatorcore/parity/capture-ours.mjs", "--base", BASE, "--viewport", VP, "--theme", "creatorcore",
]);

const REF = latest("scripts/creatorcore/out/parity");
const OURS = latest("scripts/creatorcore/out/parity-ours");

if (steps.capture.ok) {
  steps.measure = run("measure", "node", ["scripts/creatorcore/parity/report.mjs"]);
  steps.structure = run("structure", "node", [
    "scripts/creatorcore/parity/structdiff.mjs", "--ref", REF, "--ours", OURS, "--viewport", VP,
  ]);
  steps.critique = run("critique", "node", [
    "scripts/creatorcore/parity/critic.mjs", "--ours", OURS, "--ref", REF, "--viewport", VP,
  ]);
  steps.review = run("review", "node", [
    "scripts/creatorcore/parity/review.mjs", "--viewport", VP, "--base", BASE,
  ]);
}

/* ── the score ──────────────────────────────────────────────────────────────
   Four numbers, deliberately NOT collapsed into one. A single index invites
   trading a real regression in one dimension against a cosmetic win in
   another, and the whole reason the harness exists is that exactly that trade
   happened invisibly once already. `health` is first because every other
   number is meaningless when it is low. */
const read = (f) => (existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null);
const findings = read("docs/parity/findings.json");
const struct = read(`docs/parity/structure/${VP}.json`);
const crit = read(`docs/parity/critique/${VP}.json`);

const high = (a, k = "severity") => (a ?? []).filter((f) => (f[k] ?? f.sev) === "high").length;

const score = {
  at: new Date().toISOString(),
  viewport: VP,
  ours: OURS,
  ref: REF,
  /* Share of surfaces where BOTH sides resolved enough landmarks to be
     compared at all. Below ~0.6 nothing else on this line means anything. */
  measured: findings ? findings.compared ?? 0 : null,
  notMeasured: findings ? findings.notMeasured ?? 0 : null,
  propertyHigh: findings ? high(findings.findings) : null,
  structuralHigh: struct ? high(struct.findings) : null,
  structuralTotal: struct ? struct.findings.length : null,
  designHigh: crit ? high(crit.findings) : null,
  designTotal: crit ? crit.findings.length : null,
  steps: Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, v.skipped ? "skip" : v.ok ? "ok" : "fail"])),
};

mkdirSync("docs/parity", { recursive: true });
appendFileSync("docs/parity/history.jsonl", JSON.stringify(score) + "\n");

console.log("\n── score");
console.log(`   surfaces measured   ${score.measured}   (not measured ${score.notMeasured})`);
console.log(`   property  high      ${score.propertyHigh}`);
console.log(`   structural high     ${score.structuralHigh}  of ${score.structuralTotal}`);
console.log(`   design    high      ${score.designHigh}  of ${score.designTotal}`);

/* The convergence line: this run against the previous one. Printed rather than
   asserted, because a rise is sometimes correct -- a newly-measurable surface
   adds findings that were always there and simply could not be seen. */
const hist = existsSync("docs/parity/history.jsonl")
  ? readFileSync("docs/parity/history.jsonl", "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((h) => h.viewport === VP)
  : [];
if (hist.length > 1) {
  const p = hist[hist.length - 2];
  const d = (a, b) => (a == null || b == null ? "  —" : `${b - a >= 0 ? "+" : ""}${b - a}`);
  console.log("\n── since the previous run");
  console.log(`   measured ${d(p.measured, score.measured)} · property high ${d(p.propertyHigh, score.propertyHigh)} · structural high ${d(p.structuralHigh, score.structuralHigh)} · design high ${d(p.designHigh, score.designHigh)}`);
  if (score.measured < p.measured) {
    console.log("   ! fewer surfaces measured than last run. Read the Harness health section of REPORT.md");
    console.log("     before reading any improvement above it -- a capture that broke looks like a win.");
  }
}

const failed = Object.entries(steps).filter(([, v]) => !v.ok);
if (failed.length) {
  console.log(`\n${failed.length} step(s) failed: ${failed.map(([k]) => k).join(", ")}`);
  process.exit(1);
}
