/**
 * Tier 1 (raw, gitignored, disposable)  ->  Tier 2 (curated, committed, durable).
 *
 *   node scripts/creatorcore/parity/promote.mjs [--run <runId>] [--dry]
 *
 * This split is the direct answer to how the last set of captures was lost:
 * scripts/creatorcore/out/ is gitignored (.gitignore:79-80), so everything the
 * previous pass measured went with it. docs/ is NOT gitignored, and
 * .gitignore's `/*.png` is ROOT-ANCHORED, so docs/parity/**\/*.png commits with
 * no .gitignore change at all.
 *
 * Merges across runs: the newest capture wins per (surface, viewport). A
 * targeted re-run of three broken surfaces therefore does not require
 * re-capturing the other 177.
 */
import {
  readdirSync, statSync, existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync,
} from "node:fs";
import path from "node:path";

const HERE = import.meta.dirname;
const CURATED = path.join(HERE, "..", "..", "..", "docs", "parity");

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
/* Both sides promote through this one script so the curated tree, the health
   colouring and the contact sheet are produced by identical code -- the same
   reason probe.mjs is shared. --side ours reads the localhost capture. */
const SIDE = args.indexOf("--side") >= 0 ? args[args.indexOf("--side") + 1] : "ref";
if (!["ref", "ours"].includes(SIDE)) { console.error("--side must be ref or ours"); process.exit(1); }
const RAW_ROOT = path.join(HERE, "..", "out", SIDE === "ref" ? "parity" : "parity-ours");
const SUBDIR = SIDE === "ref" ? "reference" : "ours";
const LABEL = SIDE === "ref" ? "CreatorCore" : "Outreach AI (creatorcore theme)";
const onlyRun = args.includes("--run") ? args[args.indexOf("--run") + 1] : null;

if (!existsSync(RAW_ROOT)) {
  console.error(`No captures at ${RAW_ROOT}. Run capture.mjs first.`);
  process.exit(1);
}

const runs = readdirSync(RAW_ROOT)
  .filter((d) => statSync(path.join(RAW_ROOT, d)).isDirectory())
  .filter((d) => !onlyRun || d === onlyRun)
  .sort();

/** newest wins, keyed by "<viewport>/<surface>" */
const best = new Map();
for (const run of runs) {
  const runDir = path.join(RAW_ROOT, run);
  for (const vp of readdirSync(runDir)) {
    const vpDir = path.join(runDir, vp);
    if (!statSync(vpDir).isDirectory()) continue;
    for (const f of readdirSync(vpDir)) {
      if (!f.endsWith(".landmarks.json")) continue;
      const surface = f.replace(".landmarks.json", "");
      const rec = JSON.parse(readFileSync(path.join(vpDir, f), "utf8"));
      if (rec.error) continue;
      best.set(`${vp}/${surface}`, { run, vp, surface, dir: vpDir, rec });
    }
  }
}

const rows = [...best.values()].sort(
  (a, b) => a.vp.localeCompare(b.vp) || a.surface.localeCompare(b.surface)
);

let copied = 0, withheld = 0;
const byViewport = {};
for (const r of rows) {
  (byViewport[r.vp] ||= []).push(r);
  if (DRY) continue;
  const outDir = path.join(CURATED, SUBDIR, r.vp);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, `${r.surface}.landmarks.json`), JSON.stringify(r.rec, null, 2));
  for (const shot of r.rec.screenshots ?? []) {
    const src = path.join(r.dir, shot);
    if (existsSync(src)) { copyFileSync(src, path.join(outDir, shot)); copied++; }
  }
  if (!(r.rec.screenshots ?? []).length) withheld++;
}

// ---- contact sheet: every surface x every viewport, browsable -----------
const viewports = Object.keys(byViewport).sort();
const surfaces = [...new Set(rows.map((r) => r.surface))].sort();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const cell = (r) => {
  if (!r) return '<td class="miss">—</td>';
  const h = r.rec.health || {};
  const shot = (r.rec.screenshots ?? []).find((s) => s.endsWith(".viewport.png"));
  const rate = h.applicable ? Math.round((h.resolved / h.applicable) * 100) : 0;
  const cls = rate >= 80 ? "good" : rate >= 60 ? "ok" : "bad";
  const img = shot
    ? `<a href="${SUBDIR}/${esc(r.vp)}/${esc(shot)}"><img loading="lazy" src="${SUBDIR}/${esc(r.vp)}/${esc(shot)}" alt="${esc(r.surface)}"></a>`
    : '<div class="withheld">screenshot withheld<br><small>redaction moved a landmark</small></div>';
  return `<td>${img}<div class="meta ${cls}">${h.shell ?? "?"} · ${h.resolved ?? 0}/${h.applicable ?? 0} · ${rate}%</div></td>`;
};

const html = `<title>${LABEL} parity contact sheet</title>
<style>
  :root { color-scheme: light dark; --ink:#111; --dim:#666; --line:#ddd; --bg:#fff; }
  @media (prefers-color-scheme: dark){ :root{ --ink:#eee; --dim:#999; --line:#333; --bg:#111; } }
  body { font: 13px/1.5 ui-sans-serif, system-ui, sans-serif; margin:0; padding:24px; color:var(--ink); background:var(--bg); }
  h1 { font-size:20px; margin:0 0 4px; }
  p.sub { color:var(--dim); margin:0 0 20px; }
  .scroll { overflow-x:auto; }
  table { border-collapse:collapse; }
  th, td { border:1px solid var(--line); padding:6px; vertical-align:top; text-align:left; }
  th.s { position:sticky; left:0; background:var(--bg); white-space:nowrap; font-weight:600; }
  img { width:260px; height:auto; display:block; border-radius:4px; }
  .meta { font-size:11px; color:var(--dim); margin-top:4px; }
  .meta.good { color:#2a7; } .meta.ok { color:#b83; } .meta.bad { color:#c44; }
  .miss { color:var(--dim); text-align:center; }
  .withheld { width:260px; padding:28px 8px; text-align:center; color:#c44; border:1px dashed var(--line); border-radius:4px; }
</style>
<h1>${LABEL} parity contact sheet</h1>
<p class="sub">${surfaces.length} surfaces × ${viewports.length} viewports · ${copied} screenshots · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")}<br>
Reference account is READ-ONLY. Creator handles, emails and money are redacted in-page before capture, and any redaction that moved a landmark had its screenshot withheld rather than published as a layout reference.</p>
<div class="scroll"><table>
<tr><th class="s">surface</th>${viewports.map((v) => `<th>${esc(v)}</th>`).join("")}</tr>
${surfaces.map((s) => `<tr><th class="s">${esc(s)}</th>${viewports.map((v) => cell(best.get(`${v}/${s}`))).join("")}</tr>`).join("\n")}
</table></div>`;

if (!DRY) {
  mkdirSync(CURATED, { recursive: true });
  writeFileSync(path.join(CURATED, SIDE === "ref" ? "contact-sheet.html" : "contact-sheet-ours.html"), html);

  const md = [
    `# ${LABEL} parity captures`,
    "",
    SIDE === "ref"
      ? `${surfaces.length} surfaces × ${viewports.length} viewports, captured read-only from the reference account.`
      : `${surfaces.length} surfaces × ${viewports.length} viewports of our own app in the creatorcore theme.`,
    "",
    `Open \`${SIDE === "ref" ? "contact-sheet.html" : "contact-sheet-ours.html"}\` for the browsable grid. \`${SUBDIR}/<viewport>/<surface>.landmarks.json\``,
    "holds the measurements — those, not the screenshots, are the spec.",
    "",
    "| surface | " + viewports.join(" | ") + " |",
    "|---|" + viewports.map(() => "---").join("|") + "|",
    ...surfaces.map((s) =>
      `| ${s} | ` +
      viewports.map((v) => {
        const r = best.get(`${v}/${s}`);
        if (!r) return "—";
        const h = r.rec.health || {};
        return `${h.resolved ?? 0}/${h.applicable ?? 0}`;
      }).join(" | ") + " |"
    ),
  ].join("\n");
  writeFileSync(path.join(CURATED, SIDE === "ref" ? "CONTACT_SHEET.md" : "CONTACT_SHEET_OURS.md"), md);
}

console.log(`runs merged        ${runs.length}`);
console.log(`surfaces           ${surfaces.length}`);
console.log(`viewports          ${viewports.join(", ")}`);
console.log(`records promoted   ${rows.length}`);
console.log(`screenshots copied ${copied}`);
if (withheld) console.log(`screenshots withheld ${withheld} (redaction moved a landmark)`);
console.log(DRY ? "\n(dry run - nothing written)" : `\nwritten: docs/parity/`);
