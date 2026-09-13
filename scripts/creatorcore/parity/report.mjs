/**
 * The diff: their measurements vs ours, per landmark, per viewport.
 *
 *   node scripts/creatorcore/parity/report.mjs [--dry]
 *
 * Reads the newest reference run and the newest ours run, pairs surfaces
 * through pairs.mjs, and writes docs/parity/{REPORT.md,SPEC.md,report.html}.
 *
 * Triage order is fixed and deliberate: harness health FIRST. A landmark that
 * did not resolve is NOT a clean landmark, and a surface that resolved badly is
 * reported as "not measured" rather than as agreeing. docs/PARITY_LOOP.md:181 is
 * blunt about why -- two of the three findings in the first sweep were bugs in
 * the sweep, not in the product.
 */
import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import path from "node:path";
import { PAIRS, MISSING_OURS_NOTES } from "./pairs.mjs";

const HERE = import.meta.dirname;
const ROOT = path.join(HERE, "..", "..", "..");
const CURATED = path.join(ROOT, "docs", "parity");
const DRY = process.argv.includes("--dry");

const newest = (dir) => {
  if (!existsSync(dir)) return null;
  const runs = readdirSync(dir).filter((d) => statSync(path.join(dir, d)).isDirectory()).sort();
  return runs.length ? path.join(dir, runs[runs.length - 1]) : null;
};
const REF_RUN = newest(path.join(ROOT, "scripts/creatorcore/out/parity"));
const OUR_RUN = newest(path.join(ROOT, "scripts/creatorcore/out/parity-ours"));
if (!REF_RUN || !OUR_RUN) { console.error("need both a reference and an ours run"); process.exit(1); }

function load(run) {
  const out = {};
  for (const vp of readdirSync(run)) {
    const d = path.join(run, vp);
    if (!statSync(d).isDirectory()) continue;
    out[vp] = {};
    for (const f of readdirSync(d).filter((f) => f.endsWith(".landmarks.json")))
      out[vp][f.replace(".landmarks.json", "")] = JSON.parse(readFileSync(path.join(d, f), "utf8"));
  }
  return out;
}
const REF = load(REF_RUN), OURS = load(OUR_RUN);

// ---- what counts as a difference -----------------------------------------
/* Exact: these are MODES. "flex" vs "grid" is not 8% off, it is a different
   layout algorithm, so there is no tolerance band that means anything. */
const EXACT = ["display", "flexDirection", "flexWrap", "justifyContent", "alignItems",
               "gridTemplateColumns", "textTransform", "fontWeight", "position", "overflowX"];
/* Sub-pixel band: Bubble emits fractional pixels, and a 1px pitch error
   compounds to 14px down a 14-row nav, so the band is tight rather than kind. */
const PX = ["gap", "rowGap", "columnGap", "paddingTop", "paddingRight", "paddingBottom",
            "paddingLeft", "marginBottom", "borderRadius", "borderTopWidth", "borderBottomWidth",
            "borderLeftWidth", "fontSize", "letterSpacing"];
const COLOR = ["color", "backgroundColor", "borderTopColor", "borderBottomColor"];
const px = (v) => (typeof v === "string" && v.endsWith("px") ? parseFloat(v) : NaN);

/* An alpha of 0 paints nothing, so `rgba(31, 60, 239, 0)` and `rgba(0, 0, 0, 0)`
   are the same pixel -- the RGB channels of a fully transparent colour are
   whatever `currentColor` happened to be and carry no design intent. Comparing
   them as strings reported "their rail rows have an indigo background, ours
   have a black one" on 20 screens, where in fact neither paints anything.
   Normalise before comparing, never when displaying. */
const colourKey = (v) => {
  if (typeof v !== "string") return v;
  const m = v.match(/^rgba?\(([^)]+)\)$/);
  if (!m) return v;
  const parts = m[1].split(",").map((x) => x.trim());
  if (parts.length === 4 && parseFloat(parts[3]) === 0) return "transparent";
  return v;
};

function severity(kind, delta) {
  if (kind !== "px") return "high";
  const d = Math.abs(delta);
  if (d > 8) return "high";
  if (d > 2) return "medium";
  return "low";
}

/* Deviations we CHOSE. A known-intentional change reported as a defect on 30
   screens is how a parity report gets ignored, so each one is named here with
   its reason and lands in its own bucket instead of the high-severity list.
   Adding a row here is a decision; it must cite why. */
const ACCEPTED = [
  {
    landmark: /^shell\.rail\.group-first$/,
    prop: /^(color|borderTopColor|borderBottomColor)$/,
    ref: "rgba(31, 60, 239, 0.36)",
    ours: "rgba(31, 60, 239, 0.85)",
    why: "deliberate contrast fix (app/globals.css:333) -- their 0.36 measures 1.89:1 and fails WCAG AA; ours is retuned to pass, and we are not reverting an accessibility fix for parity",
  },
];
const acceptedHit = (f) =>
  ACCEPTED.find((a) => a.landmark.test(f.landmark) && a.prop.test(f.prop) &&
    String(f.ref) === a.ref && String(f.ours) === a.ours);

const findings = [];
const surfaceRows = [];
let compared = 0, notMeasured = 0;

for (const vp of Object.keys(REF)) {
  for (const [refId, ourId] of Object.entries(PAIRS)) {
    const r = REF[vp]?.[refId], o = OURS[vp]?.[ourId];
    if (!r || !o) {
      surfaceRows.push({ vp, refId, ourId, status: !r ? "REF_MISSING" : "OURS_MISSING", n: 0, high: 0 });
      continue;
    }
    /* Health gate BEFORE any value comparison. A surface where half the
       landmarks never resolved cannot be called clean; it was not measured. */
    const refHealth = r.health?.resolutionRate ?? 0;
    const ourHealth = o.health?.resolutionRate ?? 0;
    const health = Math.min(refHealth, ourHealth);
    if (health < 0.6) {
      notMeasured++;
      surfaceRows.push({
        vp, refId, ourId, status: "NOT_MEASURED", n: 0, high: 0, health, refHealth, ourHealth,
        /* Which side was short is the whole diagnosis. A reference miss is a
           resolver that does not fit their DOM; an ours miss is usually the
           page not having rendered at all, which looks identical in a count. */
        short: ourHealth < refHealth ? "ours" : refHealth < ourHealth ? "reference" : "both",
      });
      continue;
    }
    let n = 0, high = 0;
    /* MEASURED, and it changes how this report must be read:
       shell.rail is 240x970 @10,15 on BOTH sides and its rows are 220x40 at
       pitch 48, labelInset 38 on BOTH -- yet a property diff flags padding
       20px/10px vs 0, position relative vs fixed, justify-content space-between
       vs normal. CreatorCore insets its rows with padding on the rail; we inset
       ours with margins on the rows. Same box, different mechanism.

       Acting on those rows would have made a matching rail stop matching. So
       when the geometry agrees, box-model and positioning properties are NOT
       drift -- they are mechanism, and they get their own bucket. */
    const MECHANISM = new Set(["paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "marginBottom", "position", "justifyContent", "alignItems", "flexWrap", "overflowX",
      // gap/rowGap join the list for the same reason: shell.rail.items measures
      // rowGap 0 on their side and 10px on ours while PITCH IS 48 ON BOTH. They
      // space rows with margins, we use gap. Identical result, and "fixing" the
      // gap would add 10px on top of spacing that is already correct.
      "gap", "rowGap", "columnGap"]);
    for (const [lid, rl] of Object.entries(r.landmarks ?? {})) {
      const ol = o.landmarks?.[lid];
      if (rl.status !== "OK" || !ol || ol.status !== "OK") continue;
      compared++;
      const geomMatch =
        rl.rect && ol.rect &&
        Math.abs(rl.rect.w - ol.rect.w) <= 0.5 &&
        Math.abs(rl.rect.h - ol.rect.h) <= 0.5 &&
        (rl.derived?.pitch == null || ol.derived?.pitch == null ||
          Math.abs(rl.derived.pitch - ol.derived.pitch) <= 0.5);
      const add = (prop, kind, a, b, delta) => {
        let sev = geomMatch && MECHANISM.has(prop) ? "mechanism" : severity(kind, delta);
        const acc = acceptedHit({ landmark: lid, prop, ref: a, ours: b });
        if (acc) sev = "accepted";
        if (sev !== "mechanism") n++;
        if (sev === "high") high++;
        findings.push({ vp, refId, ourId, landmark: lid, prop, kind, ref: a, ours: b, delta, sev,
          why: acc?.why });
      };
      /* Same reason as the paint below: on a series these two are read off a
         row whose selection state is an accident of ordering. */
      const STATEFUL = new Set(["fontWeight", "borderRadius"]);
      for (const p of EXACT) {
        if (rl.states && ol.states && STATEFUL.has(p)) continue;
        if (rl.style?.[p] !== ol.style?.[p]) add(p, "mode", rl.style?.[p], ol.style?.[p], null);
      }
      for (const p of PX) {
        if (rl.states && ol.states && STATEFUL.has(p)) continue;
        const a = px(rl.style?.[p]), b = px(ol.style?.[p]);
        if (Number.isNaN(a) || Number.isNaN(b)) continue;
        if (Math.abs(a - b) > 0.5) add(p, "px", rl.style[p], ol.style[p], b - a);
      }
      /* For a series, the paint on items[0] belongs to whichever row happens
         to be first, and selection state differs by surface -- so it is not a
         comparison, it is a coin flip. The states block measured the same run
         twice, as rest and as selected, and those ARE comparable. */
      const series = rl.states && ol.states;
      if (!series) {
        for (const p of COLOR)
          if (rl.style?.[p] && colourKey(rl.style[p]) !== colourKey(ol.style?.[p]))
            add(p, "color", rl.style[p], ol.style[p], null);
      } else {
        for (const st of ["rest", "active"]) {
          const a = rl.states[st], b = ol.states[st];
          if (!a || !b) continue;
          for (const p of Object.keys(a)) {
            const isColour = /color/i.test(p);
            if (isColour ? colourKey(a[p]) === colourKey(b[p]) : a[p] === b[p]) continue;
            const kind = /color|shadow/i.test(p) ? "color" : "mode";
            add(`${st}.${p}`, kind, a[p], b[p], null);
          }
        }
      }
      for (const k of ["w", "h"]) {
        const a = rl.rect?.[k], b = ol.rect?.[k];
        if (a == null || b == null) continue;
        if (Math.abs(a - b) > 0.5) add(`rect.${k}`, "px", `${a}px`, `${b}px`, b - a);
      }
      for (const k of ["pitch", "gapEffective", "labelInset", "dividerCount"]) {
        const a = rl.derived?.[k], b = ol.derived?.[k];
        if (a == null || b == null) continue;
        if (Math.abs(a - b) > 0.5) add(k, "px", `${a}`, `${b}`, b - a);
      }
    }
    surfaceRows.push({ vp, refId, ourId, status: "COMPARED", n, high });
  }
}

// ---- write ----------------------------------------------------------------
if (!DRY) mkdirSync(CURATED, { recursive: true });

const bySev = (s) => findings.filter((f) => f.sev === s);
const worstLandmarks = Object.entries(
  findings.reduce((m, f) => ((m[f.landmark] = (m[f.landmark] ?? 0) + 1), m), {})
).sort((a, b) => b[1] - a[1]);
const worstProps = Object.entries(
  findings.reduce((m, f) => ((m[f.prop] = (m[f.prop] ?? 0) + 1), m), {})
).sort((a, b) => b[1] - a[1]).slice(0, 15);

const ourOnly = new Set(Object.values(OURS)[0] ? Object.keys(Object.values(OURS)[0]) : []);
for (const v of Object.values(PAIRS)) ourOnly.delete(v);

/**
 * Harness health, printed BEFORE any difference. A surface that is listed here
 * was not compared at all -- it contributes zero findings, so leaving it out of
 * the report makes a broken capture read as a parity win. Measured 2026-09-14:
 * a cold Turbopack cache served Next's dev error overlay on 27 of 39 surfaces,
 * the capture logged "156 ok / 0 failed", and the headline difference count
 * fell by 614. The `short` column is what names that in one line.
 */
function harnessHealthSection() {
  const rows = surfaceRows.filter((r) => r.status === "NOT_MEASURED");
  if (!rows.length) return ["## Harness health", "", "Every paired surface resolved enough landmarks to be compared.", ""];
  const bySide = { ours: 0, reference: 0, both: 0 };
  for (const r of rows) bySide[r.short] = (bySide[r.short] ?? 0) + 1;
  const pct = (x) => `${Math.round(x * 100)}%`;
  /* Rates are per viewport, so a whole-side collapse shows as one block rather
     than 90 lines. Worst first; the tail is elided, never silently dropped. */
  const worst = rows.sort((a, b) => a.health - b.health);
  return [
    "## Harness health",
    "",
    `**${rows.length} paired surfaces were not measured** (under 60% of their landmarks resolved on `
      + `at least one side): ${bySide.ours} short on ours, ${bySide.reference} short on the `
      + `reference, ${bySide.both} on both. They contribute no findings, so the counts above `
      + `describe only the ${compared} instances that were compared.`,
    "",
    "| viewport | surface | ref resolved | ours resolved | short side |",
    "|---|---|---|---|---|",
    ...worst.slice(0, 40).map((r) =>
      `| ${r.vp} | \`${r.refId}\` | ${pct(r.refHealth ?? 0)} | ${pct(r.ourHealth ?? 0)} | ${r.short} |`),
    ...(worst.length > 40 ? ["", `…and ${worst.length - 40} more, in \`findings.json\`.`] : []),
    "",
  ];
}

const md = [
  "# CreatorCore parity — measured diff",
  "",
  `Reference run \`${path.basename(REF_RUN)}\` · ours run \`${path.basename(OUR_RUN)}\` · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
  "",
  "Every number below was produced by **one function** (`probe.mjs`) evaluated on both",
  "sides; only the resolver differs. Nothing here is a screenshot comparison.",
  "",
  "## Headline",
  "",
  `| | |`,
  `|---|---|`,
  `| landmark instances compared | **${compared}** |`,
  `| differences found | **${findings.length}** |`,
  `| …high severity (a different layout mode, colour, or >8px) | **${bySev("high").length}** |`,
  `| …medium (2–8px) | ${bySev("medium").length} |`,
  `| …low (0.5–2px) | ${bySev("low").length} |`,
  `| mechanism-only (identical geometry, different CSS route) | ${bySev("mechanism").length} |`,
  `| accepted (a deviation we chose, with a reason) | ${bySev("accepted").length} |`,
  `| surfaces not measured (harness health < 60%) | ${notMeasured} |`,
  `| their screens we have no counterpart for | ${Object.keys(MISSING_OURS_NOTES).length} |`,
  "",
  ...harnessHealthSection(),
  "## Where the differences concentrate",
  "",
  "| landmark | differences |",
  "|---|---|",
  ...worstLandmarks.map(([k, v]) => `| \`${k}\` | ${v} |`),
  "",
  "| property | differences |",
  "|---|---|",
  ...worstProps.map(([k, v]) => `| \`${k}\` | ${v} |`),
  "",
  "## High-severity differences",
  "",
  "A different layout *mode*, a different colour, or more than 8px. These are the",
  "ones that make a screen read as a different product.",
  "",
  "| viewport | surface | landmark | property | CreatorCore | ours | Δ |",
  "|---|---|---|---|---|---|---|",
  ...bySev("high").slice(0, 120).map((f) =>
    `| ${f.vp} | ${f.refId} | \`${f.landmark}\` | \`${f.prop}\` | \`${f.ref}\` | \`${f.ours}\` | ${f.delta == null ? "—" : (f.delta > 0 ? "+" : "") + f.delta.toFixed(1)} |`),
  bySev("high").length > 120 ? `\n_…and ${bySev("high").length - 120} more._` : "",
  "",
  "## Accepted deviations",
  "",
  "Differences we chose. Listed so they are never re-reported as defects, and so",
  "the reason survives the person who made the decision.",
  "",
  ...[...new Set(bySev("accepted").map((f) => `- \`${f.landmark}\` \`${f.prop}\`: ${f.ref} → ${f.ours}\n  — ${f.why}`))],
  "",
  "## Mechanism-only differences",
  "",
  "The box is the **same size in the same place** on both sides, but reached a",
  "different way — their padding vs our margins, their `relative` vs our `fixed`.",
  "**Do not \"fix\" these.** Acting on the `shell.rail` rows below would have taken a",
  "rail that already measures 240×970 @10,15 with rows 220×40 at pitch 48 and made",
  "it stop matching.",
  "",
  "| viewport | surface | landmark | property | theirs | ours |",
  "|---|---|---|---|---|---|",
  ...bySev("mechanism").slice(0, 40).map((f) =>
    `| ${f.vp} | ${f.refId} | \`${f.landmark}\` | \`${f.prop}\` | \`${f.ref}\` | \`${f.ours}\` |`),
  bySev("mechanism").length > 40 ? `\n_…and ${bySev("mechanism").length - 40} more._` : "",
  "",
  "## Screens they have that we do not",
  "",
  "| their surface | note |",
  "|---|---|",
  ...Object.entries(MISSING_OURS_NOTES).map(([k, v]) => `| ${k} | ${v} |`),
  "",
  "## Screens we have that they do not",
  "",
  "Not failures — these are ours. They are listed so the count in the headline is",
  "not read as coverage we are missing.",
  "",
  [...ourOnly].sort().map((s) => `\`${s}\``).join(" · "),
  "",
].join("\n");

// ---- SPEC.md: how CreatorCore actually looks, without logging in ----------
const spec = ["# CreatorCore — measured layout spec", "",
  "What the reference product does, per landmark, per viewport, taken from",
  `\`${path.basename(REF_RUN)}\`. This file plus \`reference/\` is the whole point of the`,
  "harness: **the CreatorCore login is never needed again to answer a layout question.**",
  ""];
const SPEC_PROPS = ["display", "flexDirection", "justifyContent", "alignItems", "gap",
                    "gridTemplateColumns", "fontSize", "fontWeight", "letterSpacing",
                    "color", "backgroundColor", "borderRadius"];
for (const lid of worstLandmarks.map((w) => w[0]).concat(
  Object.keys(REF[Object.keys(REF)[0]]?.campaigns?.landmarks ?? {})).filter((v, i, a) => a.indexOf(v) === i)) {
  spec.push(`## \`${lid}\``, "");
  spec.push("| viewport | rect | " + SPEC_PROPS.join(" | ") + " |");
  spec.push("|---".repeat(SPEC_PROPS.length + 2) + "|");
  for (const vp of Object.keys(REF)) {
    const s = REF[vp]?.campaigns ?? Object.values(REF[vp] ?? {})[0];
    const l = s?.landmarks?.[lid];
    if (!l) continue;
    if (l.status !== "OK") { spec.push(`| ${vp} | _${l.status}_ |` + " |".repeat(SPEC_PROPS.length)); continue; }
    spec.push(`| ${vp} | ${l.rect.w}×${l.rect.h} @${l.rect.x},${l.rect.y} | ` +
      SPEC_PROPS.map((p) => `\`${l.style?.[p] ?? "—"}\``).join(" | ") + " |");
  }
  spec.push("");
}

// ---- report.html: their screen beside ours, with that pair's differences --
/* Forty crop pairs are eyeballable; forty JSON objects are not. This page is
   the check on the landmark registry itself -- if a pair looks like two
   unrelated screens, the pairing is wrong and every number under it is noise. */
const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shotFor = (side, vp, id) => `${side}/${vp}/${id}.viewport.png`;
const pairBlocks = [];
for (const row of surfaceRows.filter((r) => r.status === "COMPARED").sort((a, b) => b.high - a.high)) {
  const mine = findings.filter((f) => f.vp === row.vp && f.refId === row.refId);
  pairBlocks.push(`<section>
  <h2>${esc(row.refId)} <small>vs ${esc(row.ourId)} · ${esc(row.vp)}</small>
    <span class="badge ${row.high ? "bad" : "good"}">${row.high} high · ${row.n} total</span></h2>
  <div class="pair">
    <figure><figcaption>CreatorCore</figcaption><img loading="lazy" src="${shotFor("reference", row.vp, row.refId)}" alt=""></figure>
    <figure><figcaption>ours · creatorcore theme</figcaption><img loading="lazy" src="${shotFor("ours", row.vp, row.ourId)}" alt=""></figure>
  </div>
  ${mine.length ? `<table><tr><th>landmark</th><th>property</th><th>theirs</th><th>ours</th><th>Δ</th></tr>
  ${mine.slice(0, 40).map((f) => `<tr class="${f.sev}"><td>${esc(f.landmark)}</td><td>${esc(f.prop)}</td><td>${esc(f.ref)}</td><td>${esc(f.ours)}</td><td>${f.delta == null ? "" : (f.delta > 0 ? "+" : "") + f.delta.toFixed(1)}</td></tr>`).join("")}
  </table>` : "<p class=none>no differences</p>"}
</section>`);
}
const reportHtml = `<title>CreatorCore parity — side by side</title>
<style>
 :root{color-scheme:light dark;--ink:#111;--dim:#666;--line:#ddd;--bg:#fff;}
 @media (prefers-color-scheme:dark){:root{--ink:#eee;--dim:#999;--line:#333;--bg:#111;}}
 body{font:13px/1.55 ui-sans-serif,system-ui,sans-serif;margin:0;padding:24px;color:var(--ink);background:var(--bg);}
 h1{font-size:21px;margin:0 0 4px} p.sub{color:var(--dim);margin:0 0 24px;max-width:70ch}
 section{border-top:1px solid var(--line);padding:18px 0}
 h2{font-size:15px;margin:0 0 10px;display:flex;align-items:center;gap:10px}
 h2 small{color:var(--dim);font-weight:400}
 .badge{font-size:11px;padding:2px 8px;border-radius:999px;border:1px solid var(--line)}
 .badge.bad{color:#c44;border-color:#c44}.badge.good{color:#2a7;border-color:#2a7}
 .pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(22rem,100%),1fr));gap:14px;margin-bottom:12px}
 figure{margin:0}figcaption{font-size:11px;color:var(--dim);margin-bottom:4px}
 img{width:100%;height:auto;border:1px solid var(--line);border-radius:6px;display:block}
 table{border-collapse:collapse;font-size:12px;width:100%;overflow-x:auto;display:block}
 td,th{border:1px solid var(--line);padding:3px 7px;text-align:left}
 tr.high td{color:#c44} tr.low td{color:var(--dim)}
 p.none{color:#2a7}
</style>
<h1>CreatorCore parity — side by side</h1>
<p class="sub">${compared} landmark instances compared by one shared probe; ${findings.length} differences
(${bySev("high").length} high). Ordered worst-first. A pair that looks like two unrelated
screens means the <em>pairing</em> is wrong, not the product — check that before trusting the rows under it.</p>
${pairBlocks.join("\n")}`;

if (!DRY) {
  writeFileSync(path.join(CURATED, "report.html"), reportHtml);
  writeFileSync(path.join(CURATED, "REPORT.md"), md);
  writeFileSync(path.join(CURATED, "SPEC.md"), spec.join("\n"));
  /* `notMeasured` rides along with the findings because the two are only
     meaningful together: N differences out of M compared surfaces says nothing
     without the surfaces that were skipped. */
  writeFileSync(
    path.join(CURATED, "findings.json"),
    JSON.stringify(
      { compared, notMeasured, surfaces: surfaceRows.filter((r) => r.status !== "COMPARED"), findings },
      null,
      2
    )
  );
}
console.log(`compared ${compared} landmark instances`);
console.log(`differences: ${findings.length}  (high ${bySev("high").length} / med ${bySev("medium").length} / low ${bySev("low").length})`);
console.log(`surfaces not measured: ${notMeasured}`);
console.log(DRY ? "(dry)" : `written: docs/parity/REPORT.md, SPEC.md, findings.json`);
