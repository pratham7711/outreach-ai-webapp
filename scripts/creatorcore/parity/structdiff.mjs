/**
 * The structural diff -- "each div, each button placement".
 *
 * The ten landmarks answer "is the rail 240 wide". They cannot answer "is the
 * primary button before or after the secondary one", "is there a card around
 * the filter row", or "do we render a control they do not" -- which is what the
 * eye actually sees, and what every gap in the side-by-side composites turned
 * out to be.
 *
 * So this aligns the two `tree` arrays the probe now collects under every
 * resolved landmark and reports, per node:
 *
 *   MISSING   in theirs, not in ours
 *   EXTRA     in ours, not in theirs
 *   ORDER     present on both, at a different sequence index
 *   MOVED     same slot, origin-relative position differs by more than 4px
 *   RESIZED   same slot, box differs by more than 4px
 *   RESTYLED  same slot, paint differs (background, ink, radius, border)
 *
 * Alignment is by (role, normalised text) first and by position second, which
 * is the only pairing that survives two unrelated DOMs: their Bubble markup and
 * our React markup agree on almost nothing except what the node IS and what it
 * SAYS. Positional-only alignment would report every node as MOVED the moment
 * one extra element appeared near the top.
 *
 * Usage:
 *   node scripts/creatorcore/parity/structdiff.mjs \
 *     --ref  scripts/creatorcore/out/parity/<runId> \
 *     --ours scripts/creatorcore/out/parity-ours/<runId> \
 *     [--viewport desktop-1600]
 */
import { readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { PAIRS } from "./pairs.mjs";

const opt = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const latest = (base) => {
  if (!existsSync(base)) return null;
  const runs = readdirSync(base).filter((d) => /^\d{4}-/.test(d)).sort();
  return runs.length ? path.join(base, runs[runs.length - 1]) : null;
};

const REF = opt("--ref", latest("scripts/creatorcore/out/parity"));
const OURS = opt("--ours", latest("scripts/creatorcore/out/parity-ours"));
const VP = opt("--viewport", "desktop-1600");
const OUT = opt("--out", "docs/parity/structure");

/* Paint is compared as a signature rather than property by property: three
   declarations changing together is one decision, and reporting it three times
   is how a finding list becomes unreadable. */
const paint = (n) => `${n.bg}|${n.fg}|${n.r}|${n.bw} ${n.bc}`;
const key = (n) => `${n.role}:${n.text}`;

/**
 * Greedy alignment: exact (role, text) pairs claim each other in order, then
 * whatever is left pairs on role + nearest position. Greedy rather than a full
 * edit-distance alignment because the trees are capped at 220 nodes, they are
 * already in document order, and the failure mode of the cheap version is a
 * findings list that is slightly long -- which is recoverable, unlike one that
 * silently pairs the wrong nodes.
 */
function align(ref, ours) {
  const pairs = [];
  const usedO = new Set();
  const byKey = new Map();
  ours.forEach((n, i) => {
    const k = key(n);
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k).push(i);
  });

  ref.forEach((r, ri) => {
    const cands = byKey.get(key(r));
    let oi = -1;
    if (cands) {
      while (cands.length && usedO.has(cands[0])) cands.shift();
      if (cands.length) oi = cands.shift();
    }
    if (oi < 0 && r.text) {
      // Same role, unmatched, closest in origin-relative space.
      let best = -1, bestD = Infinity;
      ours.forEach((o, i) => {
        if (usedO.has(i) || o.role !== r.role || o.text) return;
        const d = Math.hypot(o.x - r.x, o.y - r.y);
        if (d < bestD && d < 80) { bestD = d; best = i; }
      });
      oi = best;
    }
    if (oi >= 0) usedO.add(oi);
    pairs.push({ ri, oi, ref: r, ours: oi >= 0 ? ours[oi] : null });
  });

  const extras = ours.map((n, i) => (usedO.has(i) ? null : { oi: i, ours: n })).filter(Boolean);
  return { pairs, extras };
}

function diffLandmark(lmId, ref, ours) {
  const out = [];
  const { pairs, extras } = align(ref, ours);

  for (const p of pairs) {
    const r = p.ref;
    if (!p.ours) {
      out.push({ kind: "MISSING", lm: lmId, node: `${r.role} "${r.raw}"`,
        detail: `present in the reference at ${r.x},${r.y} (${r.w}×${r.h}); nothing in ours pairs with it`,
        severity: r.role === "button" || r.role === "heading" ? "high" : "med", ref: r });
      continue;
    }
    const o = p.ours;
    const dx = +(o.x - r.x).toFixed(1), dy = +(o.y - r.y).toFixed(1);
    const dw = +(o.w - r.w).toFixed(1), dh = +(o.h - r.h).toFixed(1);

    /* Order is checked on the pair sequence, not on raw indices: a node that is
       three slots later only because two EXTRA nodes precede it is an EXTRA
       finding already, and reporting it twice is noise. */
    const refRank = pairs.filter((q) => q.ours).findIndex((q) => q === p);
    const ourRank = pairs.filter((q) => q.ours).map((q) => q.oi).sort((a, b) => a - b).indexOf(p.oi);
    if (refRank !== ourRank) {
      out.push({ kind: "ORDER", lm: lmId, node: `${r.role} "${r.raw}"`,
        detail: `sequence ${ourRank + 1} in ours, ${refRank + 1} in the reference`,
        severity: r.role === "button" ? "high" : "low", ref: r, ours: o });
    }
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) {
      out.push({ kind: "MOVED", lm: lmId, node: `${r.role} "${r.raw}"`,
        detail: `offset by ${dx >= 0 ? "+" : ""}${dx}, ${dy >= 0 ? "+" : ""}${dy}px relative to the landmark origin`,
        severity: Math.max(Math.abs(dx), Math.abs(dy)) > 24 ? "high" : "med", ref: r, ours: o });
    }
    if (Math.abs(dw) > 4 || Math.abs(dh) > 4) {
      out.push({ kind: "RESIZED", lm: lmId, node: `${r.role} "${r.raw}"`,
        detail: `${o.w}×${o.h} vs ${r.w}×${r.h}`,
        severity: Math.max(Math.abs(dw), Math.abs(dh)) > 24 ? "high" : "med", ref: r, ours: o });
    }
    if (paint(o) !== paint(r)) {
      out.push({ kind: "RESTYLED", lm: lmId, node: `${r.role} "${r.raw}"`,
        detail: `bg ${o.bg} vs ${r.bg}; ink ${o.fg} vs ${r.fg}; radius ${o.r} vs ${r.r}`,
        severity: "med", ref: r, ours: o });
    }
  }

  for (const e of extras) {
    const o = e.ours;
    /* A painted box with no text and no role is usually a wrapper, and a
       wrapper we have that they do not is rarely what the eye sees. Kept at
       low severity rather than dropped, because "is there a card around the
       filter row" is exactly that shape of node. */
    const structural = !o.text && o.role === "box";
    out.push({ kind: "EXTRA", lm: lmId, node: `${o.role} "${o.raw}"`,
      detail: `we render it at ${o.x},${o.y} (${o.w}×${o.h}); the reference has no counterpart`,
      severity: structural ? "low" : o.role === "button" ? "high" : "med", ours: o });
  }
  return out;
}

function load(dir, vp, surface) {
  const f = path.join(dir, vp, `${surface}.landmarks.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}

function main() {
  if (!REF || !OURS) {
    console.error("need both a reference run and an ours run; pass --ref/--ours");
    process.exit(2);
  }
  const rows = [];
  const findings = [];
  let withTrees = 0;

  for (const [refId, ourId] of Object.entries(PAIRS)) {
    const R = load(REF, VP, refId);
    const O = load(OURS, VP, ourId);
    if (!R || !O) { rows.push({ refId, ourId, status: "NOT_CAPTURED", n: 0 }); continue; }

    let n = 0, any = false;
    for (const [lmId, rl] of Object.entries(R.landmarks ?? {})) {
      const ol = O.landmarks?.[lmId];
      if (rl.status !== "OK" || ol?.status !== "OK") continue;
      if (!rl.tree?.length || !ol.tree?.length) continue;
      any = true;
      const d = diffLandmark(lmId, rl.tree, ol.tree);
      for (const f of d) findings.push({ surface: refId, ours: ourId, ...f });
      n += d.length;
    }
    if (any) withTrees++;
    rows.push({ refId, ourId, status: any ? "COMPARED" : "NO_TREES", n });
  }

  /* The honest failure mode of this tool: if the stored reference capture
     predates the tree probe, EVERY surface reports NO_TREES and the finding
     count is zero -- which reads exactly like parity. Say so, loudly. */
  if (!withTrees) {
    console.error(
      "\n  NO SURFACE HAD TREES ON BOTH SIDES.\n" +
      "  Zero findings here means the probe did not run, not that the structures match.\n" +
      `  The reference run at ${REF} was captured before the tree probe existed;\n` +
      "  re-capture it (scripts/creatorcore/parity/capture.mjs) before believing any number below.\n");
  }

  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${VP}.json`), JSON.stringify({ ref: REF, ours: OURS, viewport: VP, rows, findings }, null, 2));

  const bySev = (s) => findings.filter((f) => f.severity === s).length;
  const byKind = {};
  for (const f of findings) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;

  const md = [
    `# Structural diff — ${VP}`,
    "",
    `Reference \`${REF}\` · ours \`${OURS}\``,
    "",
    `**${findings.length} structural differences** across ${rows.filter((r) => r.status === "COMPARED").length} surfaces `,
    `(high ${bySev("high")} / med ${bySev("med")} / low ${bySev("low")}).`,
    "",
    "| kind | n | means |",
    "|---|---|---|",
    `| MISSING | ${byKind.MISSING ?? 0} | they render it, we do not |`,
    `| EXTRA | ${byKind.EXTRA ?? 0} | we render it, they do not |`,
    `| ORDER | ${byKind.ORDER ?? 0} | both render it, in a different sequence |`,
    `| MOVED | ${byKind.MOVED ?? 0} | same node, >4px from the landmark origin |`,
    `| RESIZED | ${byKind.RESIZED ?? 0} | same node, >4px box difference |`,
    `| RESTYLED | ${byKind.RESTYLED ?? 0} | same node, different paint |`,
    "",
    "## Highest severity, by surface",
    "",
  ];
  const bySurface = {};
  for (const f of findings.filter((f) => f.severity === "high")) {
    (bySurface[f.surface] ??= []).push(f);
  }
  for (const [s, fs] of Object.entries(bySurface).sort((a, b) => b[1].length - a[1].length).slice(0, 20)) {
    md.push(`### ${s} — ${fs.length}`, "");
    for (const f of fs.slice(0, 25)) md.push(`- \`${f.kind}\` **${f.node}** — ${f.detail} _(${f.lm})_`);
    md.push("");
  }
  writeFileSync(path.join(OUT, `${VP}.md`), md.join("\n"));

  console.log(`${findings.length} structural differences (high ${bySev("high")}) -> ${path.join(OUT, VP + ".md")}`);
  for (const r of rows.filter((r) => r.status !== "COMPARED")) console.log(`  ${r.status.padEnd(13)} ${r.refId}`);
}

main();
