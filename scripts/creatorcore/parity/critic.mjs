/**
 * The design critic. Runs `heuristics.mjs` over a capture and writes a ranked,
 * traceable critique.
 *
 * Why this exists alongside the parity diff: a diff can only say "different
 * from theirs". It is silent on the 22 screens of ours that have no reference
 * counterpart, and it is equally silent when we and the reference are both
 * wrong. It also cannot say WHY a difference matters -- "the primary button is
 * at index 2 instead of 0" is a number; "the learned scan order does not find
 * the primary action (Jakob)" is a reason to fix it.
 *
 * Every finding names the law it comes from and the token or class that would
 * move it. A critique with no lever is a complaint.
 *
 * Usage:
 *   node scripts/creatorcore/parity/critic.mjs \
 *     --ours scripts/creatorcore/out/parity-ours/<runId> \
 *     [--ref scripts/creatorcore/out/parity/<runId>] [--viewport desktop-1600]
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PAIRS } from "./pairs.mjs";
import { fitts, hicks, gestalt, nielsen, jakob } from "./heuristics.mjs";

const opt = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const latest = (base) => {
  if (!existsSync(base)) return null;
  const runs = readdirSync(base).filter((d) => /^\d{4}-/.test(d)).sort();
  return runs.length ? path.join(base, runs[runs.length - 1]) : null;
};

const OURS = opt("--ours", latest("scripts/creatorcore/out/parity-ours"));
const REF = opt("--ref", latest("scripts/creatorcore/out/parity"));
const VP = opt("--viewport", "desktop-1600");
const OUT = opt("--out", "docs/parity/critique");

const SEV = { high: 0, med: 1, low: 2 };

function load(dir, surface) {
  const f = path.join(dir, VP, `${surface}.landmarks.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}

function main() {
  if (!OURS) { console.error("no capture to critique; pass --ours"); process.exit(2); }
  const OUR_IDS = new Map(Object.entries(PAIRS).map(([r, o]) => [o, r]));
  const surfaces = existsSync(path.join(OURS, VP))
    ? readdirSync(path.join(OURS, VP)).filter((f) => f.endsWith(".landmarks.json")).map((f) => f.replace(".landmarks.json", ""))
    : [];

  const findings = [];
  let treeSurfaces = 0;

  for (const ourId of surfaces) {
    const O = load(OURS, ourId);
    if (!O) continue;
    const refId = OUR_IDS.get(ourId);
    const R = refId && REF ? load(REF, refId) : null;
    let hadTree = false;

    for (const [lmId, lm] of Object.entries(O.landmarks ?? {})) {
      if (lm.status !== "OK" || !lm.tree?.length) continue;
      hadTree = true;
      const where = `${ourId}`;
      const add = (fs) => findings.push(...fs.map((f) => ({ surface: ourId, reference: refId ?? null, ...f })));
      add(fitts(lm.tree, lmId));
      add(hicks(lm.tree, lmId));
      add(gestalt(lm.tree, lmId));
      add(nielsen(lm.tree, lmId));
      const rl = R?.landmarks?.[lmId];
      if (rl?.status === "OK" && rl.tree?.length) add(jakob(lm.tree, rl.tree, lmId));
      void where;
    }
    if (hadTree) treeSurfaces++;
  }

  if (!treeSurfaces) {
    console.error(
      "\n  NO SURFACE CARRIED A STRUCTURAL TREE.\n" +
      "  Zero findings means the probe did not run, not that the design is clean.\n" +
      `  Re-capture ${OURS} with the current probe before believing any number below.\n`);
  }

  findings.sort((a, b) => SEV[a.severity] - SEV[b.severity] || a.rule.localeCompare(b.rule));

  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${VP}.json`),
    JSON.stringify({ ours: OURS, ref: REF, viewport: VP, treeSurfaces, findings }, null, 2));

  /* Grouped by RULE, not by surface. One broken recipe repeated on 25 screens
     is one fix; a per-surface list makes it read as 25 problems and buries the
     one that is actually 25 times cheaper to solve than the rest. */
  const byRule = new Map();
  for (const f of findings) {
    if (!byRule.has(f.rule)) byRule.set(f.rule, []);
    byRule.get(f.rule).push(f);
  }

  const md = [
    `# Design critique — ${VP}`,
    "",
    `\`${OURS}\`${REF ? ` vs \`${REF}\`` : " (no reference run; Jakob rules skipped)"}`,
    "",
    "Findings come from named design laws, not from taste. Each one cites the law",
    "it fails and the token or class that would move it. Grouped by rule because",
    "one broken recipe repeated across 25 screens is **one** fix.",
    "",
    `**${findings.length} findings** over ${treeSurfaces} surfaces — ` +
      `high ${findings.filter((f) => f.severity === "high").length}, ` +
      `med ${findings.filter((f) => f.severity === "med").length}, ` +
      `low ${findings.filter((f) => f.severity === "low").length}.`,
    "",
    "| rule | law | severity | n | surfaces |",
    "|---|---|---|---|---|",
  ];
  for (const [rule, fs] of [...byRule].sort((a, b) => SEV[a[1][0].severity] - SEV[b[1][0].severity] || b[1].length - a[1].length)) {
    const ss = new Set(fs.map((f) => f.surface));
    md.push(`| \`${rule}\` | ${fs[0].law} | ${fs[0].severity} | ${fs.length} | ${ss.size} |`);
  }
  md.push("");

  for (const [rule, fs] of [...byRule].sort((a, b) => SEV[a[1][0].severity] - SEV[b[1][0].severity] || b[1].length - a[1].length)) {
    md.push(`## \`${rule}\` — ${fs[0].law}`, "", `**Fix:** ${fs[0].fix}`, "");
    const seen = new Set();
    for (const f of fs) {
      const k = `${f.surface}|${f.where}`;
      if (seen.has(k)) continue;
      seen.add(k);
      md.push(`- **${f.surface}** · ${f.where} — ${f.message}`);
      if (seen.size >= 15) { md.push(`- _…and ${fs.length - seen.size} more_`); break; }
    }
    md.push("");
  }
  writeFileSync(path.join(OUT, `${VP}.md`), md.join("\n"));

  console.log(`${findings.length} design findings over ${treeSurfaces} surfaces -> ${path.join(OUT, VP + ".md")}`);
  for (const [rule, fs] of [...byRule].sort((a, b) => SEV[a[1][0].severity] - SEV[b[1][0].severity]).slice(0, 12)) {
    console.log(`  ${fs[0].severity.padEnd(4)} ${rule.padEnd(42)} ${String(fs.length).padStart(4)}`);
  }
}

main();
