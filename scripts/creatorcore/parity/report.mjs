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

/* Module scope, ahead of the diff loop: geomMatch calls refMode(), so a `const`
   sitting beside the function body would still be in its temporal dead zone,
   and one tucked inside the loop would be block-scoped away from it. */
const refModeCache = new Map();
import { byId as LANDMARK_BY_ID } from "./landmarks.mjs";

const HERE = import.meta.dirname;
const ROOT = path.join(HERE, "..", "..", "..");
const CURATED = path.join(ROOT, "docs", "parity");
const DRY = process.argv.includes("--dry");

const newest = (dir) => {
  if (!existsSync(dir)) return null;
  const runs = readdirSync(dir).filter((d) => statSync(path.join(dir, d)).isDirectory()).sort();
  return runs.length ? path.join(dir, runs[runs.length - 1]) : null;
};
/* `newest` is the default, but a run is only comparable to one taken with the
   SAME resolver config -- change a landmark's strategy and every earlier run
   becomes a different measurement. --ref/--ours name a run explicitly so a
   resolver change does not silently pair old data with new. */
const pick = (dir, arg) => {
  const i = process.argv.indexOf(arg);
  if (i < 0 || !process.argv[i + 1]) return newest(dir);
  const v = process.argv[i + 1];
  return path.isAbsolute(v) ? v : path.join(dir, v);
};
const REF_RUN = pick(path.join(ROOT, "scripts/creatorcore/out/parity"), "--ref");
const OUR_RUN = pick(path.join(ROOT, "scripts/creatorcore/out/parity-ours"), "--ours");
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
  {
    landmark: /^page\.header-strip$/,
    prop: /^(display|alignItems|gridTemplateColumns)$/,
    when: (f) =>
      (f.prop === "display" && f.ref === "flex" && f.ours === "grid") ||
      (f.prop === "alignItems" && f.ref === "normal" && f.ours === "center") ||
      (f.prop === "gridTemplateColumns" && f.ref === "none" && /^[\d.]+px [\d.]+px$/.test(String(f.ours))),
    why:
      "Their header strip is flex; ours is a two-column grid. ONE mechanism, and it " +
      "paints nothing -- see the page.title rect.w row below for the measurement that " +
      "establishes it (15/15 paired surfaces, same text origin, same ink, nothing " +
      "clipped). The three properties are the same decision stated three ways, so they " +
      "are accepted together. The grid is deliberate: it gives the subtitle its own row " +
      "(--cc-header-areas \"title actions\" / \"subtitle subtitle\"), which is why " +
      "page.header-strip rect.h is NOT accepted here and still reports.",
  },
  {
    landmark: /^shell\.rail\.group-first$/,
    prop: /^marginBottom$/,
    when: (f) => String(f.ref) === "0px" && parseFloat(f.ours) > 0,
    why:
      "MEASURED 2026-09-14 on all 12 paired surfaces that resolve both rail " +
      "landmarks: the PAINTED gap between the group label's bottom edge and the " +
      "first nav item's top edge is 8px on their side and 8px on ours, delta " +
      "0.0px on 12/12, with pitch 48 on both. Their label carries margin-bottom " +
      "0 and the space comes from the container; ours carries the 8px itself. " +
      "Same pixels, different mechanism -- the identical padding-vs-margin case " +
      "already accepted for shell.rail.items' rowGap. It is exposed here only " +
      "because geomMatch fails on this landmark for an unrelated and separately " +
      "accepted reason (our label box is wider), so the report cannot bucket it " +
      "automatically. If the measured gap ever stops being 8px on both sides " +
      "this row must be removed -- it accepts a mechanism, not a number.",
  },
  {
    landmark: /^page\.header-strip$/,
    prop: /^(gap|rowGap)$/,
    /* Accepts a difference on the ROW axis only, and only while the column
       axis agrees at their 10px. */
    when: (f) => {
      const col = (v) => { const p = String(v).trim().split(/\s+/); return p[p.length - 1]; };
      const row = (v) => { const p = String(v).trim().split(/\s+/); return p[0]; };
      if (f.prop === "rowGap") return row(f.ref) !== row(f.ours);
      return col(f.ref) === col(f.ours) && row(f.ref) !== row(f.ours);
    },
    why:
      "The row axis paints NOTHING here. --cc-header-areas is a single row in " +
      "this theme (\"title actions\"), so there is no second row for a row gap " +
      "to sit between; the computed value still reports, but no pixel depends " +
      "on it. MEASURED 2026-09-14: their own value is not consistent either -- " +
      "`10px`, `0px 10px`, `normal` and `5px 0px` across 15 paired surfaces, so " +
      "there is no single number to match. Ours stays at their most common " +
      "10px. Splitting --cc-header-row-gap out to match `discovery` was tried " +
      "and reverted: it closed discovery and opened activations, a wash, " +
      "because those are the only two surfaces where geomMatch fails (their " +
      "activations strip is 1268 wide against 1263 elsewhere, and their " +
      "discovery strip is 45 tall against 40) and mechanism properties are " +
      "therefore exposed. The COLUMN axis is not accepted and still reports.",
  },
  {
    landmark: /^list\.rows$/,
    prop: /^(display|gridTemplateColumns)$/,
    when: (f) =>
      (f.prop === "display" && f.ref === "flex" && f.ours === "grid") ||
      (f.prop === "gridTemplateColumns" && f.ref === "none" && /px/.test(String(f.ours))),
    why:
      "Their row is flex, ours is a column grid -- the SAME mechanism already " +
      "accepted on page.header-strip above, stated on a second landmark. The two " +
      "properties are one decision written twice, so they are accepted together. " +
      "The columns are not arbitrary: they were measured off their row and the " +
      "row's painted result (height 90, ground rgb(243,245,252), full-bleed x=270 " +
      "w=1310) is matched separately and still reports if it drifts.",
  },
  {
    landmark: /^list\.rows$/,
    prop: /^rest\.fontWeight$/,
    ref: "700",
    ours: "600",
    why:
      "A harness artifact, PROVEN not inferred. `labelOf` takes the first " +
      "text-bearing descendant of the row; on our side that is the Avatar's " +
      "initials (600), not the recipient name. MEASURED 2026-09-14: our name " +
      "element computes fontWeight 700, identical to theirs -- the two sides are " +
      "reading different elements, not different weights. RecipientsClient.tsx " +
      "was changed from an inline fontWeight 600 to var(--cc-list-row-name-fw) " +
      "(700 in this theme) for exactly this row. The heuristic is deliberately " +
      "NOT rewritten: its own comment records that `last` landed on the Pay " +
      "button, so retuning it to fix this row breaks a different one.",
  },
  {
    landmark: /^campaign\.rail\.items$/,
    prop: /^flexDirection$/,
    ref: "column",
    ours: "row",
    why:
      "A one-child flex container paints the same in either direction, and " +
      "theirs has one child. MEASURED 2026-09-14 at desktop-1600, all seven " +
      "paired campaign surfaces: their row is a label and nothing else " +
      "(derived.count 8, the eight section names), while ours carries an icon, " +
      "the label and a count chip (derived.count 11 -- the eight plus an 'All " +
      "campaigns' back link and two extra sections). Everything the direction " +
      "could decide already agrees: rect 166.4x50 theirs against 166x50 ours, " +
      "x 20.8 against 21, pitch 50 on both, gapEffective 0 on both, " +
      "border-radius 10px on both, and the active row's colour, ground and " +
      "weight identical. The declaration differs because the CONTENT differs; " +
      "matching it would mean deleting the icons and the counts from our " +
      "campaign nav, which is a feature change dressed up as a style fix.",
  },
  {
    landmark: /^campaign\.rail\.items$/,
    prop: /^rest\.color$/,
    ref: "rgba(255, 255, 255, 0.5)",
    ours: "rgba(255, 255, 255, 0.6)",
    why:
      "The hue is theirs; the alpha is the contrast floor. MEASURED: white at " +
      "0.5 alpha over their rail's rgb(31,60,239) composites to " +
      "rgb(143,158,247), which is 2.82:1 against that ground -- under the 3.0 " +
      "floor e2e/contrast.spec.ts asserts on, and four campaign routes are in " +
      "its PAGES list, so shipping their exact value would fail the deploy " +
      "gate. 0.6 composites to rgb(165,177,249) and measures 3.46:1. This is " +
      "the same trade already recorded for --cc-text-subtle: match the hue " +
      "exactly, move the alpha the minimum that clears the floor, and say so.",
  },
  {
    landmark: /^page\.primary-action$/,
    prop: /^rect\.w$/,
    when: (f) => {
      const a = parseFloat(f.ref), b = parseFloat(f.ours);
      return Number.isFinite(a) && Number.isFinite(b) && b > a && b - a <= 4;
    },
    why:
      "Their primary action is a FIXED 180px box on every dashboard surface " +
      "regardless of label -- MEASURED 2026-09-14: 'New Campaign', 'New Client', " +
      "'New Creator', 'New List', 'Export Data' and 'New Recipient' are all exactly " +
      "180 (and all exactly 200 on the campaign shell). Ours is min-width 180 that " +
      "grows, so it is EXACTLY 180 on clients, creators and lists and 183.6 on " +
      "campaigns alone, whose label is the longest. " +
      "We are the outlier here, not them -- the reference-outlier rule correctly " +
      "refuses to excuse this one, which is why it is written out by hand. " +
      "It is accepted rather than fixed because both available fixes are worse than " +
      "the 3.6px: a fixed width leaves 156px of content space (180 less our 12px " +
      "padding each side) for 159.6px of icon plus text, so it clips the Plus icon " +
      "or truncates the label; and shaving the padding to 10px is a magic number " +
      "fitted to one label that the next longer one undoes. Capped at 4px and at " +
      "ours-wider-than-theirs, so a real regression still reports.",
  },
  {
    landmark: /^page\.primary-action$/,
    /* Both axes, for one reason: the padding does not change the painted box.
       MEASURED 2026-09-14 -- page.primary-action resolves on both sides on 4
       surfaces and the painted height is identical within 0.5px on 4 of 4, so
       our 4px top/bottom is absorbed rather than added. The horizontal axis is
       NOT fully absorbed and its residue stays a reported difference: campaigns
       is 180px theirs against 183.6px ours. */
    prop: /^padding(Top|Bottom|Left|Right)$/,
    /* `when`, not a ref/ours pair: the matcher requires BOTH values when they
       are given as literals, so an entry naming only `ref` can never fire. */
    when: (f) => String(f.ref) === "0px" && parseFloat(f.ours) > 0,
    why:
      "Their primary action carries no horizontal padding because it is a " +
      "FIXED-WIDTH button; ours is padded and sizes to its label. MEASURED: " +
      "adopting their fixed width clips our labels by 15.6px at 1280 and 44.4px " +
      "at 1024, and the button's own overflow-x is hidden, so the clip is silent " +
      "-- the text would simply be gone with no ellipsis. Their dataset's labels " +
      "are shorter than ours; matching the declaration would match their CSS and " +
      "break our screen. Deliberate, and revisit only if the button's labels are " +
      "ever shortened.",
  },
  {
    landmark: /^page\.header-strip$/,
    prop: /^marginBottom$/,
    ref: "0px",
    ours: "16px",
    why:
      "The SETTINGS shell only -- 16px is the value no other shell produces (the " +
      "dashboard shell is 0px and the base token is a clamp). MEASURED 2026-09-14 via " +
      "the page.content-top landmark on all five paired settings surfaces: the PAINTED " +
      "gap between the header's bottom edge and the first in-flow content below it is " +
      "16px on their side and, after this change, 16px on ours -- identical on 5/5. " +
      "They produce that space from the following element, we take it from the header's " +
      "margin, so the property disagrees while the pixels agree. That is the same " +
      "mechanism-not-drift case as the rail's padding-vs-margin row above, and it is " +
      "NOT auto-bucketed as `mechanism` only because geomMatch fails on this landmark " +
      "for an unrelated reason: their settings header is 1293x72 and ours is 1262.9x64.5, " +
      "which is its own finding and still reports. The note that previously justified " +
      "0px here compared the margin-bottom PROPERTY (theirs computes 0) instead of the " +
      "gap it paints, and read the resulting +14px content shift as damage -- the exact " +
      "mechanism-vs-pixels mistake this harness exists to catch.",
  },
  {
    landmark: /^page\.header-strip$/,
    prop: /^position$/,
    ref: "relative",
    ours: "static",
    why:
      "`position` only paints when something resolves against it. FALSIFYING TEST run " +
      "2026-09-14 on campaigns, clients, activations and settings/team: the header strip " +
      "has ZERO absolutely- or fixed-positioned descendants on all four, and forcing " +
      "position:relative on it moved ZERO of its 9-17 descendant boxes (every " +
      "getBoundingClientRect identical before and after). static and relative are the " +
      "same pixels here. If a descendant ever takes position:absolute this row must be " +
      "removed -- it would then resolve against the page instead of the strip, and the " +
      "declaration would start mattering.",
  },
  {
    landmark: /^shell\.rail\.group-first$/,
    prop: /^rect\.w$/,
    /* Same invariant as page.title: ours may be the wider box, never narrower, and
       nothing may truncate. */
    when: (f) => parseFloat(f.ours) >= parseFloat(f.ref) && !f.refTruncated && !f.oursTruncated,
    why:
      "The rail's group label -- their 174.5px against our 220px, the full column width. " +
      "MEASURED 2026-09-14 across all 12 paired surfaces: rect.x identical 12/12 (x=20 " +
      "both sides), textAlign `start` 12/12, backgroundColor identical 12/12 (BOTH fully " +
      "transparent, rgba(0,0,0,0)), border width identical 12/12, fontSize identical " +
      "12/12, ours wider-or-equal 12/12, and `truncated` false on both sides on every " +
      "one. A transparent, borderless, left-aligned label at the same origin in the same " +
      "font paints the same pixels no matter how wide its box is -- there is no edge to " +
      "see. Held back from ACCEPTED in an earlier pass on the reasoning that it was 'not " +
      "a deviation we chose'; that was wrong. It is not about intent, it is about whether " +
      "anything is visible, and nothing is. The `when` predicate is what makes that safe " +
      "to record: the moment our box is narrower than theirs, or either side truncates, " +
      "the row stops matching and the finding returns.",
  },
  {
    landmark: /^page\.title$/,
    prop: /^rect\.w$/,
    /* The invariant, not the values: ours may be WIDER than theirs (a filled grid
       column against a shrink-wrapped flex item) but never narrower, and neither
       side may be truncating. A narrower box, or any truncation, would mean the
       column is actually clipping the title and this stops being accepted. */
    when: (f) => parseFloat(f.ours) >= parseFloat(f.ref) && !f.refTruncated && !f.oursTruncated,
    why:
      "MEASURED 2026-09-14, all 15 paired surfaces at desktop-1600: rect.x identical on " +
      "14/15 (the exception is `calendar`, 290 vs 291 -- one pixel), color identical " +
      "15/15, textAlign `start` 15/15, fontSize identical 15/15, and `truncated` FALSE " +
      "on BOTH sides on every one of the 15. A box only shows where its contents land; " +
      "left-aligned text at the same origin, same size and same ink paints the same " +
      "pixels whether the box around it is 124px or 647px wide. The `when` predicate " +
      "encodes exactly that: accepted only while ours is the WIDER box and nothing is " +
      "truncated, so a grid column that ever starts clipping the title fails this row " +
      "instead of hiding behind it.",
  },
  {
    /* mobile only -- the campaign titlebar. */
    landmark: /^page\.header-strip$/,
    prop: /^(justifyContent|rect\.h)$/,
    when: (f) =>
      f.vp === "mobile-390" && /^campaign-/.test(f.refId) &&
      ((f.prop === "justifyContent" && f.ref === "space-between" && f.ours === "normal") ||
       (f.prop === "rect.h" && String(f.ref) === "53.5px")),
    why:
      "Their phone campaign header holds two affordances ours does not render there: a " +
      "nav-drawer trigger and a close button. MEASURED 2026-09-14 on the three reference " +
      "campaign surfaces that resolve the landmark, identical on all three -- the strip " +
      "spans x=20..370 while the title sits at x=124 w=166.9, i.e. 104px of the row is " +
      "occupied to the LEFT of the title and 79.1px to the right. Ours starts the title " +
      "flush at x=20 because nothing precedes it. space-between on a row with a leading " +
      "and a trailing item centres the middle one; space-between on OUR row would throw " +
      "the title left and a status badge to the far right, so copying the declaration " +
      "paints something worse, not something closer. The 53.5 vs 64 height is the same " +
      "fact on the second axis: their second row is a plain muted status line (18.5px), " +
      "ours is a badge pill (26px), and both rows sit under a 25px title. Our drawer " +
      "trigger lives in the mobile top bar instead, and we have no close-campaign " +
      "control -- moving either is an information-architecture change, not a theme one. " +
      "The two box values on this element that carry no content dependency, columnGap " +
      "and marginBottom, are NOT accepted here: columnGap is matched in globals.css " +
      "and marginBottom is the row below.",
  },
  {
    landmark: /^page\.header-strip$/,
    prop: /^marginBottom$/,
    when: (f) =>
      f.vp === "mobile-390" && /^campaign-/.test(f.refId) &&
      String(f.ref) === "0px" && String(f.ours) === "10px",
    why:
      "The 10px is the PAINTED gap, not their declaration. MEASURED on the three " +
      "reference campaign surfaces at 390: their strip carries margin-bottom 0 and " +
      "page.content-top still sits 10px below it, so the space comes from the content " +
      "block. Ours puts the same 10px on the strip. Matching their zero was tried and " +
      "reverted in the same pass -- it made page.content-top rel.below read 0px against " +
      "their 10px, which is a gap a reader can see, where the margin-bottom declaration " +
      "is not. Same pixels, different mechanism, the padding-vs-margin case already " +
      "accepted for shell.rail.group-first. If rel.below ever stops reading 10px on " +
      "both sides this row must go: it accepts a mechanism, not a number.",
  },
  {
    /* mobile only -- the dashboard strips that carry extra controls. */
    landmark: /^page\.header-strip$/,
    prop: /^rect\.h$/,
    when: (f) =>
      f.vp === "mobile-390" && String(f.ref) === "45px" && parseFloat(f.ours) > 45,
    why:
      "Feature scope inside the strip, measured from the landmark text on both sides. " +
      "Theirs on `campaigns` is the single word \"Campaigns\"; ours is " +
      "\"Campaigns | Folders | Self-serve campaign | New Campaign\". Theirs on " +
      "`calendar` is \"Deliverables Calendar\"; ours is " +
      "\"Calendar | September 2026 | Today\". The folder tabs, the month stepper and " +
      "the range controls are ours alone -- at 390 they measure 318px and 316.5px of " +
      "control, which cannot share a 328px row with a title, so the row wraps and the " +
      "strip is 126px and 84px against their 45px. This accepts a CONTENT difference, " +
      "not a box value: the same strip on a surface where both sides carry the same " +
      "controls is not covered, because the `when` requires ours to be the taller box " +
      "against their 45px flat.",
  },
  {
    landmark: /^list\.rows$/,
    prop: /^(justifyContent|alignItems|position|rect\.h|pitch)$/,
    when: (f) => f.vp === "mobile-390" && f.refId === "recipients",
    why:
      "Their phone recipient card and ours hold different things, measured from the " +
      "landmark text: theirs is \"ART | @art7cr | Active | Pay\" -- avatar, name, " +
      "handle, a status pill, a PayPal mark and a Pay button stacked on the right; ours " +
      "is \"BJ | Blessing Jolie | @blessingjolie | PayPal | $5,000.00 | \u2014 | " +
      "13 Aug 2026 | 1\", a denser data row with no per-row payment CTA. That is why " +
      "theirs stands 177px tall (pitch 177, min-height 75) and ours 130 (pitch 137.5, " +
      "min-height 90); padding ours out to 177 would add dead space, not parity. The " +
      "three mode properties ride along: they are Bubble's own row wrapper " +
      "(justify-content center on a wrap container whose single line already fills the " +
      "width, align-items normal, position relative with no offsets -- top/right/" +
      "bottom/left all 0px), and they are exposed only because geomMatch fails on the " +
      "height above. VERIFIED against a valid reference: this surface was one of the 11 " +
      "captured behind CreatorCore's phone interstitial, and the numbers here are from " +
      "the re-capture where capture.mjs dismissed it and the landmark reports hit:\"ok\".",
  },
  {
    landmark: /^(page\.title|shell\.rail\.group-first|page\.primary-action)$/,
    prop: /^overflowX$/,
    ref: "visible",
    ours: "hidden",
    why: "deliberate clamp on user data (app/globals.css: '.cc-page-title' -- \"Long campaign and list names are user data: clamp rather than push the action buttons off the row\"). MEASURED 2026-09-14: `truncated` is FALSE on every surface that resolved each of these three landmarks, both sides -- page.title 44 ref / all ours, shell.rail.group-first 14 ref / 21 ours, page.primary-action 25 ref / 8 ours, zero truncations anywhere. So the declaration differs while the painted result is identical; it is a latent guard against a name longer than any in either dataset, not a visual difference. If a future run ever reports truncated:true on our side while the reference is false, this row must be removed -- the clamp would then be clipping something they show.",
  },
];
const acceptedHit = (f) =>
  /* `ref`/`ours` are exact strings, which cannot express a deviation whose values
     differ per surface -- a fill-vs-shrink width is a different number on every
     screen. `when` is the escape hatch: a predicate over the finding, so such a
     row still has to state an INVARIANT rather than matching anything. A row
     without `when` keeps the exact-string behaviour, so nothing already accepted
     loosens. */
  ACCEPTED.find((a) => a.landmark.test(f.landmark) && a.prop.test(f.prop) &&
    (a.when ? a.when(f) : (String(f.ref) === a.ref && String(f.ours) === a.ours)));

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
      /* THEIRS RESOLVES AND OURS DOES NOT IS A DIFFERENCE, not a gap in the
         measurement. This loop used to `continue` on it, so the landmark was
         counted as "not measured" and the surface could report zero differences
         while a whole control was missing from our screen.

         MEASURED 2026-09-14, the miss this was written for: their campaign
         header carries the section's primary action on all five campaign
         sections (`Add Posts` 200x45 at x=1332) and ours rendered the same
         buttons inside the section body, so `page.primary-action` was OK on
         theirs and UNRESOLVED on ours -- and desktop-1600 reported 0 high, 0
         medium, 0 low. Nine surfaces were hidden that way at desktop, nine at
         tablet.

         MISSING_OURS is the one status that stays exempt: that is the roster of
         their screens we have no counterpart for at all, which is a product
         fact recorded in pairs.mjs rather than a defect to re-report per
         landmark. */
      if (rl.status === "OK" && (!ol || (ol.status !== "OK" && ol.status !== "MISSING_OURS"))) {
        findings.push({
          vp, refId, ourId, landmark: lid, prop: "resolved", kind: "presence",
          ref: `present${rl.text ? ` ${JSON.stringify(String(rl.text).replace(/\s+/g, " ").slice(0, 40))}` : ""}`,
          ours: ol ? String(ol.status).toLowerCase() : "absent",
          delta: null, sev: "high",
        });
        continue;
      }
      if (rl.status !== "OK" || !ol || ol.status !== "OK") continue;
      compared++;
      /* A landmark may declare `compare` -- an explicit allowlist of what is
         comparable about it. A landmark resolved by GEOMETRY rather than by
         identity (page.content-top) lands on elements that are not each other's
         counterpart, so only the measurement it was built for means anything.
         Absent the field, everything is compared, which is every other
         landmark's behaviour and unchanged. */
      const only = LANDMARK_BY_ID[lid]?.compare;
      const wanted = (prop) => !only || only.includes(prop);
      /* geomMatch decides whether a declaration difference is a MECHANISM (same
         pixels, different CSS route) or a real one, so it has to ask "is this
         the same box", not "is this the same number". An axis where the
         REFERENCE is off its own mode while we sit on it is not a box-class
         split -- it is the reference disagreeing with itself, which the
         post-pass below already accepts on that very axis. MEASURED
         2026-09-14: their campaign rail is 1000px tall on six of seven
         surfaces and 1063 on `overview` (a taller document), and that 63px
         alone was exposing position, overflow-x and justify-content on that one
         surface as high-severity findings while the identical declarations
         bucketed as mechanism on the other six. */
      const shellOf = r.health?.shell ?? "?";
      const axisOk = (k) => {
        if (Math.abs(rl.rect[k] - ol.rect[k]) <= 0.5) return true;
        const m = refMode(lid, `rect.${k}`, shellOf, vp);
        return !!m && typeof m.mode === "number" &&
          Math.abs(ol.rect[k] - m.mode) <= 0.5 && Math.abs(rl.rect[k] - m.mode) > 0.5;
      };
      const geomMatch =
        rl.rect && ol.rect && axisOk("w") && axisOk("h") &&
        (rl.derived?.pitch == null || ol.derived?.pitch == null ||
          Math.abs(rl.derived.pitch - ol.derived.pitch) <= 0.5);
      const add = (prop, kind, a, b, delta) => {
        if (!wanted(prop)) return;
        let sev = geomMatch && MECHANISM.has(prop) ? "mechanism" : severity(kind, delta);
        /* Truncation travels with the finding so an ACCEPTED `when` can test it.
           Without these the page.title rect.w guard reads `!undefined`, which is
           always true -- a guard that cannot fire is worse than no guard. */
        /* vp/refId/ourId travel with the finding too: an ACCEPTED row that is
           true on one viewport or one surface and false elsewhere has to be
           able to say so, and a `when` reading an absent field silently
           accepts everything. */
        const acc = acceptedHit({ vp, refId, ourId, landmark: lid, prop, ref: a, ours: b,
          refTruncated: rl.truncated === true, oursTruncated: ol.truncated === true });
        if (acc) sev = "accepted";
        if (sev !== "mechanism" && sev !== "not-comparable") n++;
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
            /* An unmeasurable value is not a difference. The rect loop below
               already guards this way; this loop did not, so a null ground --
               which paintedOf emits when no opaque ancestor exists -- was
               diffed against our real colour and reported as drift. */
            if (a[p] == null || b[p] == null) continue;
            const isColour = /color/i.test(p);
            if (isColour ? colourKey(a[p]) === colourKey(b[p]) : a[p] === b[p]) continue;
            const kind = /color|shadow/i.test(p) ? "color" : "mode";
            add(`${st}.${p}`, kind, a[p], b[p], null);
          }
        }
      }
      /* A SHRINK-TO-FIT text box whose two sides hold different words cannot be
         compared on width, because the width IS the words. MEASURED 2026-09-14
         on all seven paired campaign surfaces at desktop-1600: their campaign
         is called "PLAYLIST (AUG)" and the seeded one is called "PARA PARA", and
         page.title reports rect.x 238 on both, fontSize 20px on both,
         fontWeight 700 on both, color rgb(31,60,239) on both, rect.h 25 on
         both, truncated false on both -- every property that CSS decides
         agrees, and the only one that disagrees is the one the campaign's name
         decides. Reporting that as a -53px layout defect invites padding the
         title to a fixture's string length.

         Deliberately narrow: it needs BOTH texts present and different, the
         type metrics identical, and neither side truncated. A real type
         difference still reports through fontSize/fontWeight, a real clip still
         reports through `truncated`, and a box that is wider than its text (our
         dashboard title is a grid column) is not affected -- that case is a
         hand-written ACCEPTED row with its own `when`, which runs first. */
      const rTxt = (rl.text || "").trim(), oTxt = (ol.text || "").trim();
      const sameType =
        rl.style?.fontSize === ol.style?.fontSize &&
        rl.style?.fontWeight === ol.style?.fontWeight;
      const textSetsWidth =
        rTxt && oTxt && rTxt !== oTxt && sameType &&
        rl.truncated !== true && ol.truncated !== true &&
        Math.abs(rl.rect.h - ol.rect.h) <= 0.5;
      for (const k of ["w", "h"]) {
        const a = rl.rect?.[k], b = ol.rect?.[k];
        if (a == null || b == null) continue;
        if (Math.abs(a - b) <= 0.5) continue;
        if (k === "w" && textSetsWidth && !acceptedHit({ vp, refId, ourId, landmark: lid,
              prop: "rect.w", ref: `${a}px`, ours: `${b}px`,
              refTruncated: false, oursTruncated: false })) {
          findings.push({
            vp, refId, ourId, landmark: lid, prop: "rect.w", kind: "structure",
            ref: `${a}px "${rTxt.slice(0, 40)}"`, ours: `${b}px "${oTxt.slice(0, 40)}"`,
            delta: null, sev: "not-comparable",
            why: "a shrink-to-fit text box, and the two sides hold different words -- " +
              "the width is the text, not the CSS. Same rect.x, same font-size, same " +
              "font-weight, same height, nothing truncated on either side; only the " +
              "string differs. Reported as not-comparable rather than as a delta so " +
              "nobody pads a title to match a fixture's name.",
          });
          continue;
        }
        add(`rect.${k}`, "px", `${a}px`, `${b}px`, b - a);
      }
      /* The origin-relative offset. probe.mjs has always computed `rel`, but
         nothing read it, so "every measurement is relative to its origin" was
         true of the capture and not of the diff. It is gated behind `compare`
         for now rather than switched on for all 11 landmarks at once, because
         turning on a new dimension across the whole registry is its own
         measurement pass and not this one. */
      /* `below` is derived here when the capture predates the field, so a
         harness change does not force a re-capture of both sides to be read.
         Same arithmetic probe.mjs does, off the same two rects. */
      const relOf = (lm, side) => {
        if (!lm.rel) return null;
        if (lm.rel.below != null) return lm.rel;
        const org = side.landmarks?.[LANDMARK_BY_ID[lid]?.origin]?.rect;
        return org ? { ...lm.rel, below: +(lm.rect.y - (org.y + org.h)).toFixed(1) } : lm.rel;
      };
      const rRel = relOf(rl, r), oRel = relOf(ol, o);
      /* Opt-IN, unlike every other property: a landmark gets an origin-relative
         diff only by naming it in `compare`. Switching a new dimension on for
         all 11 landmarks at once is its own measurement pass, not this one --
         measured, it adds 16 findings that nobody has looked at yet. */
      /* A position diff is only meaningful if the two sides resolved the SAME
         KIND of element. MEASURED 2026-09-14 on `page.content-top`: on five
         dashboard surfaces their first content is a 200px record-count caption
         ("200 Creators", "19 Lists", "76 Recipients") while ours is the
         full-width filter bar, because we do not render that caption at all.
         Diffing their caption's top against our filter bar's produced a
         0-to-31.8px "gap", and the obvious fix for a gap is header padding --
         which would fake a missing ELEMENT with margin. So when the two
         resolved boxes are not the same width class, this reports
         not-comparable and says why, instead of a number. */
      const relWanted = ["dx", "dy", "below"].some((k) => only?.includes(`rel.${k}`));
      const anchorW = r.landmarks?.[LANDMARK_BY_ID[lid]?.origin]?.rect?.w;
      /* Same box-class question on both axes. The height threshold is MEASURED,
         not picked: on `page.content-top` the two pairs that resolve different
         elements are 2.2x apart (their 40px calendar toolbar vs our 18px status
         legend) and 6.3x apart (their 102.5px CreatorConnect card vs our 641px
         Social Platforms panel), while the one pair that genuinely matches --
         discovery, filter bar both sides -- is 1.2x. 2x sits in the gap. */
      const hi = Math.max(rl.rect.h, ol.rect.h), lo = Math.min(rl.rect.h, ol.rect.h);
      const boxClassSplit =
        relWanted && anchorW > 0 &&
        (Math.abs(rl.rect.w - ol.rect.w) > 0.2 * anchorW || (lo > 0 && hi / lo > 2));
      if (boxClassSplit) {
        findings.push({
          vp, refId, ourId, landmark: lid, prop: "rel.*", kind: "structure",
          ref: `${rl.rect.w}x${rl.rect.h}px "${(rl.text || "").replace(/\s+/g, " ").trim().slice(0, 40)}"`,
          ours: `${ol.rect.w}x${ol.rect.h}px "${(ol.text || "").replace(/\s+/g, " ").trim().slice(0, 40)}"`,
          delta: null, sev: "not-comparable",
          why: "the two sides resolved different elements, so any position delta " +
               "between them measures the mismatch, not a layout difference",
        });
      } else {
        for (const k of ["dx", "dy", "below"]) {
          if (!only?.includes(`rel.${k}`)) continue;
          const a = rRel?.[k], b = oRel?.[k];
          if (a == null || b == null) continue;
          if (Math.abs(a - b) > 0.5) add(`rel.${k}`, "px", `${a}px`, `${b}px`, b - a);
        }
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

/* ---- Reference outliers -------------------------------------------------
   The reference is not self-consistent, and most of what survived triage was
   us matching their MAJORITY while differing from their own minority pages.
   MEASURED 2026-09-14 across their 13 dashboard surfaces: page.header-strip is
   1263 wide on 9, 1268 on 3, 1270 on 1; 40 tall on 12, 45 on 1; page.title is
   30 tall on 12, 24 on 1.

   Matching an outlier BREAKS the 9-12 surfaces that currently agree, so these
   are decided differences, not open defects -- but the decision has to come
   from the data, never from a hand-written allowlist per surface. So: for each
   (landmark, property) the reference's own modal value is computed across every
   paired surface; a finding is re-bucketed only when the reference is off its
   OWN mode and ours is ON it. The mode must be a real majority (>=60% of at
   least 4 measured surfaces), otherwise there is no mode to speak of and the
   finding stands. This cannot suppress a difference where we are the odd one
   out -- that is the whole point of requiring `ours === mode`. */
function refMode(lid, prop, shell, vp) {
  /* Scoped to ONE SHELL, and that is not a detail. MEASURED 2026-09-14: pooled
     across all 25 paired surfaces, their page.header-strip width has six values
     (1263x7, 1362x6, 1293x5, 1268x3, 1065.6x2, 1270x1) and the mode is 29% --
     because the three shells are different widths BY DESIGN, not by accident.
     Split by shell the picture is real: dashboard 1263 at 64%, settings 1293 at
     100%, campaign 1362 at 75%. Pooling manufactures a fake inconsistency out of
     an intended difference. (The 60% floor caught this on its own and declined
     to fire, which is the behaviour to keep.) */
  const key = `${vp}::${shell}::${lid}::${prop}`;
  if (refModeCache.has(key)) return refModeCache.get(key);
  const counts = new Map();
  let n = 0;
  for (const [refId] of Object.entries(PAIRS)) {
    /* REF is keyed BY VIEWPORT first -- REF[vp][surface], not REF[surface]. */
    const rec = REF[vp]?.[refId];
    const v = rec?.landmarks?.[lid];
    if (!v || v.status !== "OK") continue;
    if ((rec?.health?.shell ?? "?") !== shell) continue;
    /* The population must pass the SAME box-class test the diff does. Their
       page.content-top gap is 0 on 4 of 8 dashboard surfaces (50%, no mode) --
       but two of those eight are `calendar` and `connections`, which this report
       already refuses to compare because the two sides resolve different
       elements. A mode taken over mismatched elements is not a mode. Excluding
       them leaves 5 comparable surfaces, 0 on 3 of them (60%). Whether a surface
       counts toward "what they usually do" has to be decided by the same rule
       that decides whether it counts as a difference at all. */
    const ov = OURS[vp]?.[PAIRS[refId]]?.landmarks?.[lid];
    if (!ov || ov.status !== "OK") continue;
    /* ... EXCEPT for a landmark that only ever compares a `rel.*` gap. The
       box-class test asks "are these the same kind of box", and page.content-top
       declares in its own spec that they are NOT: it is a geometric probe for
       "the topmost in-flow box below the strip", which lands on a bare caption
       <div> on seven of their surfaces and on a full-width container on the
       rest, while on ours it is always the page wrapper. That is precisely why
       its `compare` list is restricted to rel.below. Applying a width test to
       boxes the landmark has already declared incomparable does not protect the
       mode -- it shrinks the population until there is none. MEASURED
       2026-09-14 at mobile-390: it left n=2 (their lists 10, their recipients
       8), too few for any rule to speak, while the landmark has nine resolved
       dashboard surfaces to speak from. */
    const cmp = LANDMARK_BY_ID[lid]?.compare;
    const gapOnly = Array.isArray(cmp) && cmp.length > 0 && cmp.every((c) => c.startsWith("rel."));
    const aw = gapOnly ? 0 : rec.landmarks?.[LANDMARK_BY_ID[lid]?.origin]?.rect?.w;
    if (aw > 0) {
      const h1 = Math.max(v.rect.h, ov.rect.h), h2 = Math.min(v.rect.h, ov.rect.h);
      if (Math.abs(v.rect.w - ov.rect.w) > 0.2 * aw || (h2 > 0 && h1 / h2 > 2)) continue;
    }
    /* `rel.below` is DERIVED (this box's top minus the origin's bottom), so it
       lives in neither rect nor style and read as mode:null -- which quietly
       exempted the one landmark whose whole comparison is a gap. */
    let raw;
    if (prop.startsWith("rel.")) {
      const org = rec.landmarks?.[LANDMARK_BY_ID[lid]?.origin];
      if (!org || org.status !== "OK") continue;
      if (prop === "rel.below") raw = +(v.rect.y - (org.rect.y + org.rect.h)).toFixed(1);
      else if (prop === "rel.dx") raw = +(v.rect.x - org.rect.x).toFixed(1);
      else if (prop === "rel.dy") raw = +(v.rect.y - org.rect.y).toFixed(1);
      else continue;
    } else {
      raw = prop.startsWith("rect.") ? v.rect?.[prop.slice(5)] : v.style?.[prop];
    }
    if (raw == null) continue;
    /* `px` only parses a "...px" STRING and returns NaN otherwise, while rect
       values are raw numbers -- reading them through it discarded every sample
       and left n=0, so the rule silently never fired. */
    const num = typeof raw === "number" ? raw : px(String(raw));
    /* A keyword or a colour disagrees with itself the same way a number does.
       MEASURED 2026-09-14: their campaign header strip is rgb(255,255,255) on
       six of their seven campaign surfaces and transparent on `overview`, and
       justify-content is space-between on the same six and flex-start on the
       same one. Restricting the mode to numbers left those two reporting as
       high-severity colour and layout-mode differences against a value their
       own product uses once. Strings are counted verbatim -- exact equality,
       no normalising -- so this can only ever excuse a value we match exactly. */
    const key2 = Number.isNaN(num) ? String(raw) : num;
    n++;
    counts.set(key2, (counts.get(key2) ?? 0) + 1);
  }
  if (process.env.CC_DEBUG_POP) console.error("[pop]", key, "n=", n, JSON.stringify([...counts.entries()]));
  let best = null, bestN = 0;
  for (const [v, c] of counts) if (c > bestN) { best = v; bestN = c; }
  const nums = [...counts.keys()].filter((v) => typeof v === "number");
  /* `spread` travels alongside the mode so the second post-pass can ask the
     weaker question -- "is our value inside the band their own pages occupy" --
     without re-walking every surface. It is only populated for numbers. */
  const spread = nums.length >= 3
    ? { min: Math.min(...nums), max: Math.max(...nums), distinct: nums.length, total: n,
        all: [...counts.entries()].filter(([v]) => typeof v === "number")
          .sort((a, b) => a[0] - b[0]).map(([v, c]) => `${v}x${c}`).join(", ") }
    : null;
  /* `distinct === n` is TOTAL disagreement: every comparable reference surface
     gives a different value from every other, which is stronger evidence of
     reference inconsistency than four surfaces with three values -- so it is
     the one case the four-surface floor may be dropped to three for. MEASURED
     2026-09-14 at desktop-1440: page.content-top's gap below the header strip
     survives the box-class test on exactly three of their dashboard surfaces
     (discovery 0, lists 16.9, recipients 35.8) and is a different number on
     each. No value matches even two of them; ours is 21.4 on all of ours, and
     any move to match one breaks the other two. The floor stays at four
     wherever a majority is possible at all. */
  const totalDisagree = !!spread && spread.distinct === n;
  const out = n >= 4 && bestN / n >= 0.6
    ? { mode: best, hits: bestN, total: n, spread }
    : ((n >= 4 || (n >= 3 && totalDisagree)) && spread ? { mode: null, spread } : null);
  refModeCache.set(key, out);
  return out;
}
/* LOW is in scope too, and the old medium/high restriction was arbitrary. This
   pass fires only when the reference disagrees with ITSELF and ours is either on
   their modal value or inside the band their own pages occupy -- evidence that
   does not get weaker as the difference gets smaller. Skipping low left four
   findings standing that the rule already had the data to decide. MEASURED
   2026-09-14: their mobile dashboard header strip is 348, 328, 330, 218, 269.8,
   348, 348, 233 and 328 wide across nine surfaces (ours 328 on all nine, exact
   on two of theirs), and their tablet gap under that strip is 4, 0, 10, 10 and
   8 across the five that survive the box-class test (ours 8, exact on one).
   There is no value that closes one of those without opening another, which is
   the condition this rule exists to recognise. */
for (const f of findings) {
  if (f.sev !== "medium" && f.sev !== "high" && f.sev !== "low") continue;
  const shell = REF[f.vp]?.[f.refId]?.health?.shell ?? "?";
  const m = refMode(f.landmark, f.prop, shell, f.vp);
  if (process.env.CC_DEBUG_OUTLIER) console.error("[outlier]", f.refId, f.landmark, f.prop, "shell=", shell, "mode=", JSON.stringify(m), "ref=", f.ref, "ours=", f.ours);
  if (!m) continue;
  const numOf = (x) => (typeof x === "number" ? x : px(String(x)));
  if (m.mode == null) {
    /* No majority at all -- but their own pages do not agree with each other,
       and ours sits inside the band they occupy. MEASURED 2026-09-14 at
       tablet-768: the gap between their header strip and the record-count
       caption is 0, 4, 8, 10 and 10px across their five list pages, so there is
       no value that matches them all and every candidate is wrong somewhere.
       Deliberately weaker than the mode rule and deliberately narrow: it needs
       at least four comparable surfaces, at least three DISTINCT reference
       values, and our value inside their own min..max. Step outside their range
       by a pixel and it reports again. */
    const rvv = numOf(f.ref), ovv = numOf(f.ours);
    if (!m.spread || Number.isNaN(rvv) || Number.isNaN(ovv)) continue;
    if (ovv < m.spread.min - 0.5 || ovv > m.spread.max + 0.5) continue;
    f.sev = "accepted";
    f.why =
      `the reference has no single value here: ${f.prop} on their own ${shell} ` +
      `surfaces measures ${m.spread.all} (${m.spread.distinct} distinct values over ` +
      `${m.spread.total} surfaces, no majority). Ours is ${f.ours}, inside their own ` +
      `${m.spread.min}-${m.spread.max} band, so this delta is bounded by their ` +
      `inconsistency rather than by ours. Accepted only while we stay inside that ` +
      `range -- a pixel outside it reports again.`;
    continue;
  }
  const rv = numOf(f.ref), ov = numOf(f.ours);
  if (typeof m.mode === "string") {
    /* String mode: exact match on both sides, and colours through colourKey so
       `rgb(255,255,255)` and `#fff` are the same value rather than two. */
    const same = (a, b) => a === b || colourKey(a) === colourKey(b);
    if (same(String(f.ref), m.mode)) continue;       // reference is ON its mode
    if (!same(String(f.ours), m.mode)) continue;     // we are NOT on it
  } else {
    if (Number.isNaN(rv) || Number.isNaN(ov)) continue;
    if (Math.abs(rv - m.mode) <= 0.5) continue;      // reference is ON its mode -- a real difference
    if (Math.abs(ov - m.mode) > 0.5) continue;       // we are NOT on it -- our problem, keep reporting
  }
  f.sev = "accepted";
  f.why =
    `the reference disagrees with itself here: ${f.prop} is ${m.mode} on ${m.hits} of ` +
    `${m.total} of their own ${shell} surfaces and ${f.ref} on this one. Ours is ${f.ours}, ` +
    `which IS their modal value -- matching this surface would break the ${m.hits} that ` +
    `already agree. Re-bucketed from the data, not an allowlist: it fires only while ` +
    `ours equals their mode.`;
}

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
  `| not comparable (the two sides resolved different elements) | ${bySev("not-comparable").length} |`,
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
  "## Not comparable",
  "",
  "The landmark resolved on both sides, but to **different elements**, so any",
  "delta between them measures the mismatch rather than a layout difference.",
  "These are reported, never counted as parity differences, and each one is a",
  "question about STRUCTURE — usually an element one side renders and the other",
  "does not. MEASURED 2026-09-14: their five dashboard list pages carry a",
  "record-count caption under the header (\"200 Creators\", \"19 Lists\") that we",
  "do not render at all.",
  "",
  "| viewport | surface | landmark | theirs | ours |",
  "|---|---|---|---|---|",
  ...bySev("not-comparable").map((f) =>
    `| ${f.vp} | ${f.refId} → ${f.ourId} | \`${f.landmark}\` | ${f.ref} | ${f.ours} |`),
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
